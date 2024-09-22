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
        this.inlineChats= inlineChats.filter((chat: any) => chat.commandType === 1);
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
            await vscode.commands.executeCommand('editor.action.inlineDiffs.acceptAll');
            let newInlineChats: any;
            let newChat: string | undefined;
            const maxAttempts = 12; // 60 seconds total (12 * 5 seconds)
            let attempts = 0;
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 5 seconds

            while (attempts < maxAttempts) {
                newInlineChats = await readVSCodeState(getDBPath(this.context), 'aiService.prompts');
                try {
                    newChat = getSingleNewEditorText(oldInlineChats, newInlineChats.filter((chat: any) => chat.commandType === 1));
                } catch (error) {
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
                    attempts++;
                    continue;
                }
                if (newChat) {
                    break; // Exit the loop if we found a new chat
                }
            }

            if (!newChat) {
                throw new Error('No new chat found after 60 seconds');
            }
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
    public async parsePanelChatAsync(): Promise<PanelChat[]> {
        try {
            const raw_data = await readVSCodeState(getDBPath(this.context), 'workbench.panel.aichat.view.aichat.chatdata');

            if (!raw_data) {
                return [];
            }

            if (!Array.isArray(raw_data.tabs)) {
                vscode.window.showErrorMessage('Invalid internal chat data structure.');
                return [];
            }

            const panelChats = raw_data.tabs.map((tab: any) => {
                const panelChat: PanelChat = {
                    ai_editor: "cursor",
                    customTitle: tab.chatTitle || '',
                    id: tab.tabId,
                    parent_id: null,
                    created_on: new Date(tab.lastSendTime).toISOString(),
                    messages: [],
                    kv_store: {}
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
                            id: userBubble.id,
                            messageText: userBubble.text || '',
                            responseText: aiBubble.text || '',
                            model: aiBubble.modelType || 'Unknown',
                            timestamp: new Date(tab.lastSendTime).toISOString(),
                            context: [], // Extract context if needed,
                            kv_store: {}
                        };
                        panelChat.messages.push(messageEntry);
                    }
                }
                return panelChat;
            });
            // Filter out empty panelChats
            const nonEmptyPanelChats = panelChats.filter((chat: PanelChat) => chat.messages.length > 0);
            return nonEmptyPanelChats;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to parse panel chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return [];
        }
    }
}
