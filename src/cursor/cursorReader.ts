import * as vscode from 'vscode';
import * as Diff from 'diff';
import * as Inline from '../inline';
import { readVSCodeState } from '../tools/dbReader';
import { AIChangeMetadata, Context, MessageEntry, PanelChat, StashedState, StateReader, TimedFileDiffs } from '../types';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { FileDiff, InlineChatInfo } from '../inline';
import posthog from 'posthog-js';
import { debug } from '../debug';
const SCHEMA_VERSION = '1.0';

/**
 * Interface representing an interactive session.
 */
type CursorInlines  = {
    text: string;
    commandType: number
}

/**
 * Retrieves a single new editor text from the sessions.
 */
function getSingleNewEditorText(oldSessions: CursorInlines[], newSessions: CursorInlines[]): CursorInlines[] {
    const list1Count: { [key: string]: number } = {};
    const newElements: CursorInlines[] = [];

    function inlineToKey(item: CursorInlines): string {
        return item.text + item.commandType;
    }

    // Count occurrences of each string in list1
    oldSessions.forEach((item) => {
        list1Count[inlineToKey(item)] = (list1Count[inlineToKey(item)] || 0) + 1;
    });

    // Compare each string in list2 with list1
    newSessions.forEach((item) => {
        if (list1Count[inlineToKey(item)]) {
            list1Count[inlineToKey(item)]--;
        } else {
            newElements.push(item);
        }
    });
    return newElements;
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
    private inlineChats: CursorInlines[] | null = null;
    private inlineStartInfo: Inline.InlineStartInfo | null = null;
    private timedFileDiffs: TimedFileDiffs[] = [];
    private fileDiffCutoff: number = 60000;
    private hasComposerData: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.initialize(); // Call the async initializer
    }

    private async initialize() {
        try {
            const composerData = await readVSCodeState(getDBPath(this.context), 'composer.composerData');
            if (composerData) {
                this.hasComposerData = true;
            }
        } catch (error) {
            // If the key doesn't exist, keep hasComposerData as false
            this.hasComposerData = false;
        }
    }

    public pushFileDiffs(file_diffs: FileDiff[], metadata: AIChangeMetadata): void {
        this.timedFileDiffs.push({
            timestamp: new Date().toISOString(),
            file_diffs: file_diffs,
            metadata: metadata
        });
    }

    public async matchPromptsToDiff(): Promise<boolean> {
        if (this.inlineChats === null) {
            const inlineChats = await readVSCodeState(getDBPath(this.context), 'aiService.prompts');
            this.inlineChats= inlineChats.filter((chat: any) => chat.commandType === 1 || (!this.hasComposerData && chat.commandType === 4));
            return false;
        }
        const oldInlineChats = this.inlineChats;
        const newInlineChats =  await readVSCodeState(getDBPath(this.context), 'aiService.prompts') || oldInlineChats;
        const newChats =  getSingleNewEditorText(
            oldInlineChats,
            newInlineChats.filter((chat: any) => this.hasComposerData ? chat.commandType === 1 : (chat.commandType === 1 || chat.commandType === 4))
        );
        this.inlineChats = newInlineChats.filter((chat: any) => this.hasComposerData ? chat.commandType === 1 : (chat.commandType === 1 || chat.commandType === 4));
        if (newChats.length === 0) {
            const oneMinuteAgo = new Date(Date.now() - this.fileDiffCutoff).toISOString();
            while (this.timedFileDiffs.length > 0 && this.timedFileDiffs[0].timestamp < oneMinuteAgo) {
                this.timedFileDiffs.shift();
            }
            return false;
        }
        let added = false;
        for (const newChat of newChats) {
            let matchedDiff: TimedFileDiffs | undefined;
            if (newChat.commandType === 1) {
                for (const diff of this.timedFileDiffs) {
                    if (diff.metadata.inlineChatStartInfo) {
                        matchedDiff = diff;
                        this.timedFileDiffs.splice(this.timedFileDiffs.indexOf(diff), 1);
                        break;
                    }
                }
            }
            if (!matchedDiff) {
                matchedDiff = this.timedFileDiffs.pop();
            }
            if (!matchedDiff) {
                this.fileDiffCutoff = Math.min(this.fileDiffCutoff+ 10000, 60000);
                return false;
            }
            const inlineChatInfoObj: InlineChatInfo = {
                inline_chat_id: uuidv4(),
                file_diff: matchedDiff.file_diffs,
                selection: null,
                timestamp: new Date().toISOString(),
                prompt: newChat.text,
                parent_inline_chat_id: null,
            };
            Inline.writeInlineChat(this.context, inlineChatInfoObj);
            added = true;
            if (newChat.commandType === 1 ) {
                vscode.window.showInformationMessage(`Recorded Inline Chat - ${newChat.text}`);
                posthog.capture('cursor_inline_chat');
            } else if (newChat.commandType === 4) {
                vscode.window.showInformationMessage(`Recorded Composer Chat - ${newChat.text}`);
                posthog.capture('cursor_composer_chat');
            }
        }
        return added;
    }

    /**
     * Initializes the extension by reading interactive sessions.
     */
    public async startInline(inlineStartInfo: Inline.InlineStartInfo) {
        const inlineChats = await readVSCodeState(getDBPath(this.context), 'aiService.prompts');
        this.inlineChats= inlineChats.filter((chat: any) => chat.commandType === 1 || (!this.hasComposerData && chat.commandType === 4));
        this.inlineStartInfo = inlineStartInfo;
    }

    private parseContext(userMessage: any): Context[] {
        let context: Context[] = [];
        if (!userMessage) {
            return context;
        }
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

    /**
     * Parses the panel chat from interactive sessions and assigns UUIDs based on existing order.
     */
    public async parsePanelChatAsync(): Promise<PanelChat[]> {
        try {
            const raw_data = await readVSCodeState(getDBPath(this.context), 'workbench.panel.aichat.view.aichat.chatdata');

            if (!raw_data) {
                debug("No cursor raw data found");
                return [];
            }
            debug("Cursor raw data found");

            if (!Array.isArray(raw_data.tabs)) {
                vscode.window.showErrorMessage('Invalid internal chat data structure.');
                posthog.capture('invalid_internal_chat_data_structure');
                return [];
            }
            let panelChats: PanelChat[] = [];
            raw_data.tabs.forEach((tab: any) => {
                if (tab.bubbles.length >= 2) {
                    const panelChat: PanelChat = {
                        ai_editor: "cursor",
                        customTitle: tab.chatTitle || '',
                        id: tab.tabId,
                        parent_id: null,
                        created_on: new Date(tab.lastSendTime).toISOString(),
                        messages: [],
                        kv_store: {}
                    };

                    // Group bubbles into pairs (user message and AI response)
                    for (let i = 0; i < tab.bubbles.length; i += 2) {
                        const userBubble = tab.bubbles[i];
                        const aiBubble = tab.bubbles[i + 1];

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
                    panelChats.push(panelChat);
                }
            });
            // Filter out empty panelChats
            const nonEmptyPanelChats = panelChats.filter((chat: PanelChat) => chat.messages.length > 0);

           // Process composer chats if composerData exists
        if (this.hasComposerData) {
            const composerData = await readVSCodeState(getDBPath(this.context), 'composer.composerData');
            debug("Composer data found");
            if (composerData && Array.isArray(composerData.allComposers)) {
                composerData.allComposers.forEach((composer: any) => {
                    const created_on = new Date(parseInt(composer.createdAt)).toISOString();
                    const panelChat: PanelChat = {
                        ai_editor: "cursor-composer",
                        customTitle: composer.composerId || '',
                        id: composer.composerId,
                        parent_id: null,
                        created_on: created_on,
                        messages: [],
                        kv_store: { "isComposer": true }
                    };

                    // Pair conversations sequentially: user message (type=1) followed by AI response (type=2)
                    for (let i = 0; i < composer.conversation.length - 1; ) {
                        const conv = composer.conversation[i];
                        const nextConv = composer.conversation[i + 1];

                        if (conv.type === 1 && nextConv.type === 2) {
                            const messageEntry: MessageEntry = {
                                id: conv.bubbleId, // Using userConv.bubbleId for the message ID
                                messageText: conv.text || '',
                                responseText: nextConv.text || '',
                                model: nextConv.modelType || 'Unknown',
                                timestamp: (conv.timestamp ? new Date(conv.timestamp).toISOString() : created_on),
                                context: this.parseContext(conv.context),
                                kv_store: {}
                            };
                            panelChat.messages.push(messageEntry);
                            i += 2; // Move to the next pair
                        } else {
                            // If the current pair doesn't match, move to the next conversation
                            i += 1;
                        }
                    }

                    if (panelChat.messages.length > 0) {
                        panelChat.customTitle = panelChat.messages[0].messageText;
                        nonEmptyPanelChats.push(panelChat);
                    }
                });
                }
            }

            return nonEmptyPanelChats;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to parse panel chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return [];
        }
    }
}
