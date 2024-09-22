import * as vscode from 'vscode';
import * as Diff from 'diff';
import * as Inline from '../inline';
import { readVSCodeState } from '../tools/dbReader';
import { Context, MessageEntry, PanelChat, StashedState, StateReader } from '../types';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
const SCHEMA_VERSION = '1.0';


/**
 * Interface representing an interactive session.
 */
interface InteractiveSession {
    history: {
        editor: {
            text: string;
            state: {
                chatContextAttachments: any[];
                chatDynamicVariableModel: any[];
            }
        }[];
        copilot: any[];
    }
}


/**
 * Validates if the object is a valid InteractiveSession.
 */
function isValidInteractiveSession(obj: any): obj is InteractiveSession {
    return (
        obj &&
        typeof obj === 'object' &&
        obj.history &&
        Array.isArray(obj.history.editor) &&
        obj.history.editor.every((entry: any) =>
            typeof entry.text === 'string' &&
            entry.state &&
            Array.isArray(entry.state.chatContextAttachments) &&
            Array.isArray(entry.state.chatDynamicVariableModel)
        )
    );
}

/**
 * Retrieves a single new editor text from the sessions.
 */
function getSingleNewEditorText(oldSessions: InteractiveSession, newSessions: InteractiveSession): string {
    const oldEditorTexts = new Set(oldSessions.history.editor.map(entry => entry.text));
    const newEditorTexts = newSessions.history.editor
        .filter(entry => entry.text && !oldEditorTexts.has(entry.text))
        .map(entry => entry.text);

    if (newEditorTexts.length !== 1) {
        throw new Error(newEditorTexts.length === 0 ? "No new editor text found." : "Multiple new editor texts found.");
    }

    return newEditorTexts[0];
}

function getDBPath(context: vscode.ExtensionContext): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || !context.storageUri) {
        throw new Error('No workspace folder or storage URI found');
    }
    const dbPath = path.join(path.dirname(context.storageUri.fsPath), 'state.vscdb');
    return dbPath;
}


export class VSCodeReader implements StateReader {
    private context: vscode.ExtensionContext;
    private interactiveSessions: InteractiveSession | null = null;
    private inlineStartInfo: Inline.InlineStartInfo | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }


    /**
     * Initializes the extension by reading interactive sessions.
     */
    public async startInline(inlineStartInfo: Inline.InlineStartInfo) {
        const interactiveSessions = await readVSCodeState(getDBPath(this.context), 'memento/interactive-session');
        this.interactiveSessions= interactiveSessions;
        this.inlineStartInfo = inlineStartInfo;
    }

    /**
     * Processes the editor content during inline chat acceptance.
     */
    public async acceptInline(editor: vscode.TextEditor) {
        const oldInteractiveSessions: any = this.interactiveSessions;
        if (!isValidInteractiveSession(oldInteractiveSessions)) {
            throw new Error('Old interactive sessions are invalid or not found.');
        }

        const newContent = editor.document.getText();
        const lastInline = this.inlineStartInfo;
        this.inlineStartInfo = null;
        if (Inline.isInlineStartInfo(lastInline)) {
            const diff = Diff.diffLines(lastInline.content, newContent);
            await vscode.commands.executeCommand('inlineChat.acceptChanges');

            await new Promise(resolve => setTimeout(resolve, 2000));
            const newInteractiveSessions: any = await readVSCodeState(getDBPath(this.context), 'memento/interactive-session');
            
            if (!isValidInteractiveSession(newInteractiveSessions)) {
                throw new Error('New interactive sessions are invalid or not found.');
            }
            const newChat = getSingleNewEditorText(oldInteractiveSessions, newInteractiveSessions);
            const inlineChatInfoObj = Inline.InlineStartToInlineChatInfo(lastInline, diff, newChat);

            Inline.writeInlineChat(inlineChatInfoObj);
            this.interactiveSessions = null;
        } else {
            throw new Error('No valid content stored in last_inline_start');
        }
    }

    /**
     * Parses the panel chat from interactive sessions and assigns UUIDs based on existing order.
     */
    public async parsePanelChatAsync(): Promise<PanelChat[]> {
        try {

            const interactiveSessions = await readVSCodeState(getDBPath(this.context), 'interactive.sessions');

            if (!interactiveSessions) {
                vscode.window.showErrorMessage('Interactive sessions data is not available.');
                return [];
            }
            
            if (!Array.isArray(interactiveSessions)) {
                vscode.window.showErrorMessage('Interactive sessions data is not an array.');
                return [];
            }
    
            const panelChats: PanelChat[] = interactiveSessions.map((panel: any, index: number) => {
                const ai_editor: string = "copilot";
                const customTitle: string = typeof panel.customTitle === 'string' ? panel.customTitle : '';
    
                // Determine if this PanelChat has an existing UUID
                let id: string = typeof panel.sessionId === 'string' ? panel.sessionId : '';
        
                const parent_id: string | null = null;
                const created_on: string = typeof panel.creationDate === 'string' ? panel.creationDate : new Date().toISOString();

                // Extract messages
                const messages: MessageEntry[] = panel.requests.map((request: any) => {
                    const messageText: string = typeof request.message?.text === 'string' ? request.message.text : '';
                    let id: string = '';
                    if (request.result && request.result.metadata && typeof request.result.metadata.modelMessageId === 'string') {
                        id = request.result.metadata.modelMessageId;
                    }
                    // Safely extract responseText
                    let responseText: string = '';
    
                    if (Array.isArray(request.response)) {
                        // Concatenate all response values into a single string, separated by newlines
                        const validResponses = request.response
                            .map((response: any) => response.value)
                            .filter((value: any) => typeof value === 'string' && value.trim() !== '');
    
                        responseText = validResponses.join('\n');
                    } else if (typeof request.response?.value === 'string') {
                        responseText = request.response.value;
                    }
    
                    // Extract model and timestamp if available
                    const model: string = typeof request.model === 'string' ? request.model : 'Unknown';
                    const timestamp: string = typeof request.timestamp === 'string' ? request.timestamp : new Date().toISOString();
    
                    // Extract context if available
                    let contextData: Context[]  = [];
                    if (Array.isArray(request.context)) {
                        contextData = request.context
                            .map((ctx: any) => {
                                if (typeof ctx.type === 'string' && typeof ctx.value === 'string') {
                                    switch (ctx.type) {
                                        case 'RelativePath':
                                        case 'SymbolFromReferences':
                                        case 'SymbolInFile':
                                            return { context_type: ctx.type, key: ctx.key, value: ctx.value } as Context;
                                        default:
                                            return undefined;
                                    }
                                }
                                return undefined;
                            })
                            .filter((ctx: Context | undefined) => ctx !== undefined) as Context[];
                    }
    
                    return {
                        id, // Assign new UUID to MessageEntry
                        messageText,
                        responseText,
                        model,
                        timestamp,
                        context: contextData,
                    };
                }).filter((entry: MessageEntry) =>
                    entry.messageText.trim() !== '' && entry.responseText.trim() !== ''
                );
    
                return {
                    ai_editor,
                    customTitle,
                    id,
                    parent_id,
                    created_on,
                    messages,
                } as PanelChat;
            });
    
            return panelChats;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to parse panel chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return [];
        }
    }
}
