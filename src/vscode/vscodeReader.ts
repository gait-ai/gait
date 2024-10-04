import * as vscode from 'vscode';
import * as Diff from 'diff';
import * as Inline from '../inline';
import { readVSCodeState } from '../tools/dbReader';
import { AIChangeMetadata, Context, MessageEntry, PanelChat, StashedState, StateReader, TimedFileDiffs } from '../types';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { FileDiff, InlineChatInfo } from '../inline';
import posthog from 'posthog-js';

function fnv1aHash(str: string): number {
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 16777619) >>> 0; // FNV prime and keep it 32-bit unsigned
    }
    return hash;
}


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
function getSingleNewEditorText(oldSessions: InteractiveSession, newSessions: InteractiveSession): string[] {
    let oldEditorTexts;
    if (!oldSessions.history.editor) {
        oldEditorTexts = new Set();
    } else {
        oldEditorTexts = new Set(oldSessions.history.editor.map(entry => entry.text));
    }
    if (!newSessions.history.editor) {
        return [];
    }
    const newEditorTexts = newSessions.history.editor.map(entry => entry.text).filter(text => !oldEditorTexts.has(text)); 

    return newEditorTexts;
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
    private timedFileDiffs: TimedFileDiffs[] = [];

    public pushFileDiffs(file_diffs: FileDiff[], metadata: AIChangeMetadata): void {
        this.timedFileDiffs.push({
            timestamp: new Date().toISOString(),
            file_diffs: file_diffs,
            metadata: metadata
        });
    }

    public async matchPromptsToDiff(): Promise<boolean> {
        if (this.interactiveSessions === null) {
            const inlineChats = await readVSCodeState(getDBPath(this.context), 'memento/interactive-session');
            this.interactiveSessions= inlineChats;
            return false;
        }
        const oldInlineChats = this.interactiveSessions;
        const newInlineChats =  await readVSCodeState(getDBPath(this.context), 'memento/interactive-session');

        this.interactiveSessions = newInlineChats;
        const newChats =  getSingleNewEditorText(oldInlineChats, newInlineChats);
        if (newChats.length === 0) {
            const oneMinuteAgo = new Date(Date.now() - 15000).toISOString();
            while (this.timedFileDiffs.length > 0 && this.timedFileDiffs[0].timestamp < oneMinuteAgo) {
                this.timedFileDiffs.shift();
            }
            return false;
        }
        const context = this.context;

        let added = false
        
        for (const newChat of newChats) {
            let matchedDiff: TimedFileDiffs | undefined;
            for (const diff of this.timedFileDiffs) {
                if (diff.metadata.inlineChatStartInfo) {
                    matchedDiff = diff;
                    this.timedFileDiffs.splice(this.timedFileDiffs.indexOf(diff), 1);
                    break;
                }
            }
            if (!matchedDiff) {
                matchedDiff = this.timedFileDiffs.pop();
            }
            if (!matchedDiff) {
                console.error("error no file diffs");
                vscode.window.showErrorMessage('No file diffs found for new prompts!');
                posthog.capture('vscode_error_no_file_diffs_found_for_new_prompts');
                return false;
            }
            const inlineChatInfoObj: InlineChatInfo = {
                inline_chat_id: uuidv4(),
                file_diff: matchedDiff.file_diffs,
                selection: null,
                timestamp: new Date().toISOString(),
                prompt: newChat,
                parent_inline_chat_id: null,
            };
            Inline.writeInlineChat(context, inlineChatInfoObj);
            posthog.capture('vscode_inline_chat');
            added = true;
            vscode.window.showInformationMessage(`Recorded Inline Request - ${newChat}`);
        }
        return added;
    }

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

    private parseContext(request: any): Context[] {
        let context: Context[] = [];

        if (request.contentReferences && Array.isArray(request.contentReferences)) {
            request.contentReferences.forEach((ref: any) => {
                if (ref.kind === 'reference' && ref.reference) {
                    const { range, uri } = ref.reference;
                    if (range && uri) {
                        context.push({
                            context_type: "selection",
                            key: uuidv4(),
                            value: {
                                human_readable: uri.fsPath || '',
                                uri: uri.fsPath || '',
                                range: {
                                    startLine: range.startLineNumber || 0,
                                    startColumn: range.startColumn || 0,
                                    endLine: range.endLineNumber || 0,
                                    endColumn: range.endColumn || 0
                                },
                                text: '' // Note: We don't have the actual text content here
                            }
                        });
                    }
                }
            });
        }
        return context;
    }

    /**
     * Parses the panel chat from interactive sessions and assigns UUIDs based on existing order.
     */
    public async parsePanelChatAsync(): Promise<PanelChat[]> {
        try {

            const interactiveSessions = await readVSCodeState(getDBPath(this.context), 'interactive.sessions');

            if (!interactiveSessions) {
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
                let id: string = panel.sessionId;
        
                const parent_id: string | null = null;
                const created_on: string = typeof panel.creationDate === 'string' ? panel.creationDate : new Date().toISOString();

                // Extract messages
                const messages: MessageEntry[] = panel.requests.map((request: any) => {
                    const messageText: string = typeof request.message?.text === 'string' ? request.message.text : '';
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
                    let contextData: Context[]  = this.parseContext(request);
    
                    let id: string = '';
                    if (request.result && request.result.metadata && typeof request.result.metadata.modelMessageId === 'string') {
                        id = request.result.metadata.modelMessageId;
                    } else {
                        id = fnv1aHash(messageText + responseText).toString();
                    }
                    return {
                        id, 
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
                    messages
                } as PanelChat;
            });
    
            return panelChats;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to parse panel chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return [];
        }
    }
}
