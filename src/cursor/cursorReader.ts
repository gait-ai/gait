import * as vscode from 'vscode';
import * as Diff from 'diff';
import * as Inline from '../inline';
import { readVSCodeState } from '../tools/dbReader';
import { AIChangeMetadata, Context, MessageEntry, PanelChat, StashedState, StateReader, TimedFileDiffs } from '../types';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { FileDiff, InlineChatInfo } from '../inline';
import posthog from 'posthog-js';
const SCHEMA_VERSION = '1.0';

/**
 * Interface representing an interactive session.
 */
type CursorInlines  = {
    text: string;
    commandType: number
}

/**
 * @description Computes the differences between two lists of `CursorInlines` objects.
 * It identifies the elements present in the first list that are not present in the
 * second list, and returns these elements as a new list.
 *
 * @param {CursorInlines[]} oldSessions - Used to store the content of editor sessions
 * from a previous state.
 *
 * @param {CursorInlines[]} newSessions - Used to compare with the `oldSessions`
 * parameter and identify new elements.
 *
 * @returns {CursorInlines[]} An array of objects containing cursor position information
 * and text.
 */
function getSingleNewEditorText(oldSessions: CursorInlines[], newSessions: CursorInlines[]): CursorInlines[] {
    const list1Count: { [key: string]: number } = {};
    const newElements: CursorInlines[] = [];

    /**
     * @description Concatenates two properties of a `CursorInlines` object, `text` and
     * `commandType`, to form a string key.
     *
     * @param {CursorInlines} item - Used to generate a unique key combining the inline
     * text and command type.
     *
     * @returns {string} A concatenation of two strings: the text of an item and its
     * command type.
     */
    function inlineToKey(item: CursorInlines): string {
        return item.text + item.commandType;
    }

    // Count occurrences of each string in list1
    oldSessions.forEach((item) => {
        // Counts occurrences of each item in oldSessions.
        list1Count[inlineToKey(item)] = (list1Count[inlineToKey(item)] || 0) + 1;
    });

    // Compare each string in list2 with list1
    newSessions.forEach((item) => {
        // Decrements a count or adds an item to a list.
        if (list1Count[inlineToKey(item)]) {
            list1Count[inlineToKey(item)]--;
        } else {
            newElements.push(item);
        }
    });
    return newElements;
}



/**
 * @description Determines the path to a database file named 'state.vscdb' within the
 * storage directory of a Visual Studio Code extension, relative to the workspace
 * folder or the extension's storage URI if no workspace folder exists.
 *
 * @param {vscode.ExtensionContext} context - Used to access the storage URI of the
 * extension.
 *
 * @returns {string} A file path to a database file named `state.vscdb`.
 */
function getDBPath(context: vscode.ExtensionContext): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || !context.storageUri) {
        throw new Error('No workspace folder or storage URI found');
    }
    const dbPath = path.join(path.dirname(context.storageUri.fsPath), 'state.vscdb');
    return dbPath;
}

/**
 * @description Maintains state and reads data from the VS Code environment to
 * facilitate interactions with the AI chat service, processing user input, and storing
 * chat history for analysis and recording purposes.
 *
 * @implements {StateReader}
 */
export class CursorReader implements StateReader {
    private context: vscode.ExtensionContext;
    private inlineChats: CursorInlines[] | null = null;
    private inlineStartInfo: Inline.InlineStartInfo | null = null;
    private timedFileDiffs: TimedFileDiffs[] = [];
    private fileDiffCutoff: number = 60000;
    private hasComposerData: boolean = false;

    /**
     * @description Assigns the provided `vscode.ExtensionContext` to the instance variable
     * `context` and initiates the initialization process through the `initialize` method.
     *
     * @param {vscode.ExtensionContext} context - A reference to the current extension's
     * context, providing access to its configuration and other resources.
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.initialize(); // Call the async initializer
    }

    /**
     * @description Retrieves composer data from the database based on the current context.
     * If the data exists, it sets the `hasComposerData` property to `true`; otherwise,
     * it catches the error and keeps `hasComposerData` as `false`.
     */
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

    /**
     * @description Stores a collection of file differences along with their metadata at
     * a specific timestamp in a list, allowing for tracking of file changes over time.
     *
     * @param {FileDiff[]} file_diffs - Used to store changes made to files.
     *
     * @param {AIChangeMetadata} metadata - Used to store additional information about
     * the file changes.
     */
    public pushFileDiffs(file_diffs: FileDiff[], metadata: AIChangeMetadata): void {
        this.timedFileDiffs.push({
            timestamp: new Date().toISOString(),
            file_diffs: file_diffs,
            metadata: metadata
        });
    }

    /**
     * @description Matches newly received inline chat prompts to existing file diffs,
     * writes the matched diffs to the database, and updates the file diff cutoff time.
     *
     * @returns {Promise<boolean>} Resolved to a boolean value indicating whether any new
     * inline chats were added.
     */
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
     * @description Fetches existing inline chats from a database, filters them based on
     * specific command types, and stores the filtered chats and the provided `inlineStartInfo`
     * in instance properties.
     *
     * @param {Inline.InlineStartInfo} inlineStartInfo - Used to initialize the
     * `inlineStartInfo` property of the class instance.
     */
    public async startInline(inlineStartInfo: Inline.InlineStartInfo) {
        const inlineChats = await readVSCodeState(getDBPath(this.context), 'aiService.prompts');
        this.inlineChats= inlineChats.filter((chat: any) => chat.commandType === 1 || (!this.hasComposerData && chat.commandType === 4));
        this.inlineStartInfo = inlineStartInfo;
    }

    /**
     * @description Extracts relevant information from a `userMessage` object and returns
     * an array of `Context` objects, which represent selections, files, folders, and
     * documents selected by the user.
     *
     * @param {any} userMessage - Exchanged with data from an external source, likely a
     * messaging system or event.
     *
     * @returns {Context[]} An array of objects containing contextual information about
     * the user's input.
     */
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
                // Processes each file selection and adds its data to a context array.
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
                // Processes folder selections.
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
                // Pushes a selected document context to an array.
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
     * @description Extracts chat data from the VS Code state, processes it into a
     * structured format, and returns a list of non-empty panel chats. It also handles
     * composer chats and pairs user messages with AI responses to create a conversation
     * history.
     *
     * @returns {Promise<PanelChat[]>} An array of objects that represent conversations
     * in a chat panel.
     */
    public async parsePanelChatAsync(): Promise<PanelChat[]> {
        try {
            const raw_data = await readVSCodeState(getDBPath(this.context), 'workbench.panel.aichat.view.aichat.chatdata');

            if (!raw_data) {
                return [];
            }

            if (!Array.isArray(raw_data.tabs)) {
                vscode.window.showErrorMessage('Invalid internal chat data structure.');
                posthog.capture('invalid_internal_chat_data_structure');
                return [];
            }
            let panelChats: PanelChat[] = [];
            raw_data.tabs.forEach((tab: any) => {
                // Transforms raw chat data into structured panel chats.
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
            if (composerData && Array.isArray(composerData.allComposers)) {
                composerData.allComposers.forEach((composer: any) => {
                    // Processes composer data.
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
