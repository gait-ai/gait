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
type CursorInlines  = {
    text: string;
    commandType: number
}[]

/**
 * Retrieves a single new editor text from the sessions.
 */
function getSingleNewEditorText(oldSessions: CursorInlines, newSessions: CursorInlines): CursorInlines {
    const oldEditorTexts = new Set(oldSessions.map(entry => entry.text));
    const newEditorTexts = newSessions
        .filter(entry => entry.text && !oldEditorTexts.has(entry.text));

    if (newEditorTexts.length !== 1) {
        throw new Error(newEditorTexts.length === 0 ? "No new editor text found." : "Multiple new editor texts found.");
    }

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
        this.inlineChats= inlineChats.filter((chat: any) => chat.commandType === 1 || chat.commandType === 4);
        this.inlineStartInfo = inlineStartInfo;
    }

    private parseContext(userMessage: any): Context[] {
        let context: Context[] = [];
        // Parse and add selections to panelChat.context if available
        if (userMessage.selections && Array.isArray(userMessage.selections)) {
            userMessage.selections.forEach((selection: any) => (
                context.push({
                    context_type: "selection",
                    key: uuidv4(),
                    value: {
                        human_readable: selection.uri?.fsPath || '',
                        uri: selection.uri?.fsPath || '',
                        range: {
                            startLine: selection.range?.selectionStartLineNumber || 0,
                            startColumn: selection.range?.selectionStartColumn || 0,
                            endLine: selection.range?.positionLineNumber || 0,
                                endColumn: selection.range?.positionColumn || 0
                            },
                        text: selection.rawText || ''
                    }
                }))
            );
        }
        // Parse and add file selections to context if available
        if (userMessage.fileSelections && Array.isArray(userMessage.fileSelections)) {
            userMessage.fileSelections.forEach((fileSelection: any) => {
                if (fileSelection.uri) {
                    context.push({
                        context_type: "file",
                        key: uuidv4(),
                        value: {
                            human_readable: fileSelection.uri.fsPath || '',
                            uri: fileSelection.uri.fsPath || '',
                            isCurrentFile: fileSelection.isCurrentFile || false,
                        }
                    });
                }
            });
        }
        // Parse and add folder selections to context if available
        if (userMessage.folderSelections && Array.isArray(userMessage.folderSelections)) {
            userMessage.folderSelections.forEach((folderSelection: any) => {
                if (folderSelection.relativePath) {
                    context.push({
                        context_type: "folder",
                        key: uuidv4(),
                        value: {
                            human_readable: folderSelection.relativePath,
                            relativePath: folderSelection.relativePath,
                        }
                    });
                }
            });
        }

        // Parse and add selected docs to context if available
        if (userMessage.selectedDocs && Array.isArray(userMessage.selectedDocs)) {
            userMessage.selectedDocs.forEach((doc: any) => {
                if (doc.docId) {
                    context.push({
                        context_type: "selected_doc",
                        key: uuidv4(),
                        value: {
                            human_readable: doc.name || '',
                            docId: doc.docId,
                            name: doc.name || '',
                            url: doc.url || '',
                        }
                    });
                }
            });
        }
        return context;
    }

    private async getNewPrompt(){
        const oldInlineChats: any = this.inlineChats;
        let newInlineChats: any;
        console.log("Getting new prompt");

        const maxAttempts = 12; // 60 seconds total (12 * 5 seconds)
        let attempts = 0;
        let newChat: {
            text: string;
            commandType: number
        } | undefined;
        while (attempts < maxAttempts) {
            newInlineChats = await readVSCodeState(getDBPath(this.context), 'aiService.prompts');
            console.log("New inline chats: ", newInlineChats.length);
            try {
                newChat = getSingleNewEditorText(oldInlineChats, newInlineChats.filter((chat: any) => chat.commandType === 1 || chat.commandType === 4))[0];
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
        return newChat;
    }
    /**
     * Processes the editor content during inline chat acceptance.
     * 
     * Should be called very quickly after detection so we can capture the prompt.
     */
    public async acceptInline(editor: vscode.TextEditor, file_diffs: Inline.FileDiff[] | null) {
        const inlineChats = await readVSCodeState(getDBPath(this.context), 'aiService.prompts');
        this.inlineChats= inlineChats.filter((chat: any) => chat.commandType === 1 || chat.commandType === 4);
        const newContent = editor.document.getText();
        const lastInline = this.inlineStartInfo;
        this.inlineStartInfo = null;
        let inlineChatInfoObj: Inline.InlineChatInfo;
        const newChat = await this.getNewPrompt();
        console.log("New chat: ", JSON.stringify(newChat));
        if (Inline.isInlineStartInfo(lastInline) && newChat.commandType === 1) {
            inlineChatInfoObj = Inline.InlineStartToInlineChatInfo(lastInline, newContent, newChat.text);

            Inline.writeInlineChat(inlineChatInfoObj);
            this.inlineChats = null;
        } else if (newChat.commandType === 4 && file_diffs) {
            inlineChatInfoObj  = {
                inline_chat_id: uuidv4(),
                file_diff: file_diffs,
                selection: null,
                timestamp: new Date().toISOString(),
                prompt: newChat.text,
                parent_inline_chat_id: null,
            };
            Inline.writeInlineChat(inlineChatInfoObj);
            this.inlineChats = null;
        } else {
            vscode.window.showInformationMessage('No inline chat info found.');
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
                            context: this.parseContext(userBubble), // Extract context if needed,
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
