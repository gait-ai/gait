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
type CursorInlines  = [{
    text: string;
    commandType: number
}]

/**
 * Retrieves a single new editor text from the sessions.
 */
function getSingleNewEditorText(oldSessions: CursorInlines, newSessions: CursorInlines): string {
    const oldEditorTexts = new Set(oldSessions.map(entry => entry.text));
    const newEditorTexts = newSessions
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

export class CursorReader implements StateReader {
    private context: vscode.ExtensionContext;
    private inlineChats: CursorInlines | null = null;
    private inlineStartInfo: Inline.InlineStartInfo | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Initializes the extension by reading interactive sessions.
     */
    public async startInline(inlineStartInfo: Inline.InlineStartInfo) {
        const inlineChats = await readVSCodeState(getDBPath(this.context), 'aiService.prompts');
        this.inlineChats= inlineChats.filter((chat: any) => chat.commandType === 2);
        this.inlineStartInfo = inlineStartInfo;
    }

    /**
     * Processes the editor content during inline chat acceptance.
     */
    public async acceptInline(editor: vscode.TextEditor) {
        const oldInlineChats: any = this.inlineChats;

        const newContent = editor.document.getText();
        const lastInline = this.inlineStartInfo;
        this.inlineStartInfo = null;
        if (Inline.isInlineStartInfo(lastInline)) {
            const diff = Diff.diffLines(lastInline.content, newContent);
            await vscode.commands.executeCommand('inlineChat.acceptChanges');

            await new Promise(resolve => setTimeout(resolve, 2000));
            const newInlineChats: any = await readVSCodeState(getDBPath(this.context), 'aiService.prompts');
            
            const newChat = getSingleNewEditorText(oldInlineChats, newInlineChats);
            const inlineChatInfoObj = Inline.InlineStartToInlineChatInfo(lastInline, diff, newChat);

            Inline.writeInlineChat(inlineChatInfoObj);
            this.inlineChats = null;
        } else {
            throw new Error('No valid content stored in last_inline_start');
        }
    }

    /**
     * Parses the panel chat from interactive sessions and assigns UUIDs based on existing order.
     */
    public async parsePanelChatAsync(existingIds: string[]): Promise<StashedState> {
        try {
            const raw_data = await readVSCodeState(getDBPath(this.context), 'workbench.panel.aichat.view.aichat.chatdata');

            if (!raw_data || !Array.isArray(raw_data.tabs)) {
                vscode.window.showErrorMessage('Invalid chat data structure.');
                return { panelChats: [], schemaVersion: SCHEMA_VERSION, lastAppended: { order: [], lastAppendedMap: {} } };
            }

            const panelChats = raw_data.tabs.map((tab: any, index: number) => {

                // Determine if this PanelChat has an existing UUID
                let id: string;
                const existingIndex = index - (raw_data.length - existingIds.length);
                if (existingIndex >= 0 && existingIndex < existingIds.length) {
                    // Assign existing UUID
                    id = existingIds[existingIndex];
                } else {
                    // Assign new UUID
                    id = uuidv4();
                }
                const panelChat: PanelChat = {
                    ai_editor: "cursor",
                    customTitle: tab.chatTitle || '',
                    id: id,
                    parent_id: null,
                    created_on: new Date(tab.lastSendTime).toISOString(),
                    messages: []
                };
                // Filter out bubbles with empty text
                const filteredBubbles = tab.bubbles.filter((bubble: any) => bubble.text && bubble.text.trim() !== '');
                tab.bubbles = filteredBubbles;

                // Group bubbles into pairs (user message and AI response)
                for (let i = 0; i < filteredBubbles.length; i += 2) {
                    const userBubble = filteredBubbles[i];
                    const aiBubble = filteredBubbles[i + 1];

                    if (userBubble && userBubble.type === 'user' && aiBubble && aiBubble.type === 'ai') {
                        const messageEntry: MessageEntry = {
                            id: uuidv4(),
                            messageText: userBubble.text || '',
                            responseText: aiBubble.text || '',
                            model: aiBubble.modelType || 'Unknown',
                            timestamp: new Date(tab.lastSendTime).toISOString(),
                            context: [], // Extract context if needed
                        };
                        panelChat.messages.push(messageEntry);
                    }
                }
                return panelChat;
            });
            return { panelChats, schemaVersion: SCHEMA_VERSION, lastAppended: { order: [], lastAppendedMap: {} } };
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to parse panel chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return { panelChats: [], schemaVersion: SCHEMA_VERSION, lastAppended: { order: [], lastAppendedMap: {} } };
        }
    }
}
