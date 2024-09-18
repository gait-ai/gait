import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as Diff from 'diff';
import * as Inline from './inline';
import * as InlineDecoration from './inlinedecoration';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PanelViewProvider } from './panelview';
import { monitorPanelChatAsync } from './panelChats';
import { parse } from 'csv-parse/sync';


const execAsync = promisify(exec);

// Constants for global state keys and file paths
const LAST_APPENDED_FILE = 'lastAppended.txt';
const GAIT_FOLDER_NAME = '.gait';

/**
 * Interface representing the VSCode state.
 */
interface VSCodeState {
    [key: string]: any;
}

let disposibleDecorations: { decorationTypes: vscode.Disposable[], hoverProvider: vscode.Disposable } | undefined;
let decorationsActive = true;

/**
 * Function to redecorate the editor.
 */
function redecorate(context: vscode.ExtensionContext) {
    if (disposibleDecorations) {
        disposibleDecorations.decorationTypes.forEach(decoration => decoration.dispose());
        disposibleDecorations.hoverProvider.dispose();
    }

    if (decorationsActive) {
        disposibleDecorations = InlineDecoration.decorateActive(context);
    }
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
 * Parses the VSCode state from the SQLite database.
 */
async function parseVSCodeState(dbPath: string): Promise<VSCodeState> {
    try {
        const escapedDbPath = `"${dbPath}"`;
        const itemTableOutput = await execAsync(`sqlite3 ${escapedDbPath} -readonly -csv "SELECT key, value FROM ItemTable;"`);

        const records = parse(itemTableOutput.stdout, {
            columns: ['key', 'value'],
            skip_empty_lines: true,
        });

        return records.reduce((state: VSCodeState, record: { key: string; value: string }) => {
            const { key, value } = record;
            try {
                state[key] = JSON.parse(value);
            } catch {
                state[key] = value;
            }
            return state;
        }, {});
    } catch (error) {
        console.error(`Error querying SQLite DB: ${error}`);
        throw error;
    }
}

/**
 * Reads a specific key from the VSCode state.
 */
export async function readVSCodeState(context: vscode.ExtensionContext, key: string): Promise<any> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || !context.storageUri) {
        throw new Error('No workspace folder or storage URI found');
    }

    const dbPath = path.join(path.dirname(context.storageUri.fsPath), 'state.vscdb');
    const state = await parseVSCodeState(dbPath);

    if (key in state) {
        return state[key];
    } else {
        vscode.window.showInformationMessage(`No data found for key: ${key}`);
        return [];
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

/**
 * Initializes the extension by reading interactive sessions.
 */
async function initializeAsync(context: vscode.ExtensionContext) {
    const interactiveSessions = await readVSCodeState(context, 'memento/interactive-session');
    await context.workspaceState.update('memento/interactive-session', interactiveSessions);
}

/**
 * Processes the editor content during inline chat acceptance.
 */
async function processEditorContent(context: vscode.ExtensionContext, editor: vscode.TextEditor) {
    const oldInteractiveSessions: any = context.workspaceState.get('memento/interactive-session');
    if (!isValidInteractiveSession(oldInteractiveSessions)) {
        throw new Error('Old interactive sessions are invalid or not found.');
    }

    const newContent = editor.document.getText();
    const lastInline = context.workspaceState.get("last_inline_start");

    if (Inline.isInlineStartInfo(lastInline)) {
        const diff = Diff.diffLines(lastInline.content, newContent);
        await vscode.commands.executeCommand('inlineChat.acceptChanges');

        await new Promise(resolve => setTimeout(resolve, 2000));
        const newInteractiveSessions: any = await readVSCodeState(context, 'memento/interactive-session');
        
        if (!isValidInteractiveSession(newInteractiveSessions)) {
            throw new Error('New interactive sessions are invalid or not found.');
        }
        const newChat = getSingleNewEditorText(oldInteractiveSessions, newInteractiveSessions);
        const inlineChatInfoObj = Inline.InlineStartToInlineChatInfo(lastInline, diff, newChat);

        Inline.writeInlineChat(inlineChatInfoObj);
    } else {
        throw new Error('No valid content stored in last_inline_start');
    }
}

/**
 * Creates the .gait folder and necessary files if they don't exist.
 */
function createGaitFolderIfNotExists(workspaceFolder: vscode.WorkspaceFolder) {
    const gaitFolderPath = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
    if (!fs.existsSync(gaitFolderPath)) {
        fs.mkdirSync(gaitFolderPath);
        vscode.window.showInformationMessage(`${GAIT_FOLDER_NAME} folder created successfully`);
    }

    const lastAppendedPath = path.join(gaitFolderPath, LAST_APPENDED_FILE);
    if (!fs.existsSync(lastAppendedPath)) {
        fs.writeFileSync(lastAppendedPath, '0', 'utf-8');
        vscode.window.showInformationMessage(`${LAST_APPENDED_FILE} created successfully`);
    }

    if (!fs.existsSync(path.join(gaitFolderPath, 'panelChatsCommited.json'))) {
        fs.writeFileSync(path.join(gaitFolderPath, 'panelChatsCommited.json'), '[]');
        vscode.window.showInformationMessage('panelChatsCommited.json created successfully');
    }

    const gitAttributesPath = path.join(workspaceFolder.uri.fsPath, '.gitattributes');
    const gitAttributesContent = fs.existsSync(gitAttributesPath)
        ? fs.readFileSync(gitAttributesPath, 'utf-8')
        : '';

    if (!gitAttributesContent.includes(`${GAIT_FOLDER_NAME}/ -diff`)) {
        fs.appendFileSync(gitAttributesPath, `\n${GAIT_FOLDER_NAME}/ -diff\n`);
        vscode.window.showInformationMessage('.gitattributes updated successfully');
    }
}

/**
 * Activates the extension.
 */
export function activate(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage('Gait Copilot extension activated');

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found. Extension activation failed.');
        return;
    }

    createGaitFolderIfNotExists(workspaceFolder);

    setTimeout(() => {
        monitorPanelChatAsync(context);
    }, 3000); // Delay to ensure initial setup

    const provider = new PanelViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PanelViewProvider.viewType, provider, { webviewOptions: { retainContextWhenHidden: true } })
    );

    console.log('WebviewViewProvider registered for', PanelViewProvider.viewType);

    const gaitDir = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
    const panelChatPath = path.join(gaitDir, 'stashedPanelChats.json');

    const updateSidebarCommand = vscode.commands.registerCommand('gait-copilot.updateSidebar', async () => {
        vscode.window.showInformationMessage('Updating sidebar content');
        try {
            provider.updateContent();
        } catch (error) {
            vscode.window.showErrorMessage(`Error updating sidebar: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const helloWorldCommand = vscode.commands.registerCommand('gait-copilot.helloWorld', async () => {
        try {
            const interactiveSessions = context.workspaceState.get<InteractiveSession[]>('interactive.sessions', []);
            vscode.window.showInformationMessage(`${JSON.stringify(interactiveSessions, null, 2)}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        vscode.commands.executeCommand('inlineChat.start');
    });

    const inlineChatStartOverride = vscode.commands.registerCommand('gait-copilot.startInlineChat', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const selection = editor.selection;
            const inlineStartInfo: Inline.InlineStartInfo = {
                fileName: vscode.workspace.asRelativePath(document.uri),
                content: document.getText(),
                lineCount: document.lineCount,
                startTimestamp: new Date().toISOString(),
                startSelection: selection.start,
                endSelection: selection.end,
                selectionContent: document.getText(selection),
                parent_inline_chat_id: null,
            };
            initializeAsync(context).catch((error) => {
                vscode.window.showErrorMessage(`Failed to initialize extension: ${error instanceof Error ? error.message : 'Unknown error'}`);
            });
            context.workspaceState.update("last_inline_start", inlineStartInfo);
        }
        vscode.commands.executeCommand('inlineChat.start');
    });


    const inlineChatContinue = vscode.commands.registerCommand('gait-copilot.continueInlineChat', (args) => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                try {
                    // Create a selection from the start line to the end line
                    const startPosition = new vscode.Position(args.startLine, 0);
                    const endPosition = new vscode.Position(args.endLine, editor.document.lineAt(args.endLine).text.length);
                    const newSelection = new vscode.Selection(startPosition, endPosition);

                    // Set the new selection
                    editor.selection = newSelection;
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to set selection: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }

                const document = editor.document;
                const selection = editor.selection;
                const inlineStartInfo: Inline.InlineStartInfo = {
                    fileName: vscode.workspace.asRelativePath(document.uri),
                    content: document.getText(),
                    lineCount: document.lineCount,
                    startTimestamp: new Date().toISOString(),
                    startSelection: selection.start,
                    endSelection: selection.end,
                    selectionContent: document.getText(selection),
                    parent_inline_chat_id: args.parent_inline_chat_id,
                };

                initializeAsync(context).catch((error) => {
                    vscode.window.showErrorMessage(`Failed to initialize extension: ${error instanceof Error ? error.message : 'Unknown error'}`);
                });
                context.workspaceState.update("last_inline_start", inlineStartInfo);

                vscode.commands.executeCommand('inlineChat.start');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to continue inline chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const inlineChatAcceptOverride = vscode.commands.registerCommand('gait-copilot.acceptInlineChat', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            processEditorContent(context, editor).catch(error => {
                vscode.window.showErrorMessage(`Failed to process editor content: ${error instanceof Error ? error.message : 'Unknown error'}`);
            });

            redecorate(context);
        }
    });

    const openFileWithContentCommand = vscode.commands.registerCommand('gait-copilot.openFileWithContent', async (args) => {
        try {
            // Create a new untitled document
            vscode.workspace.openTextDocument({
                content: args.content,
                language: args.languageId // You can change this to match the content type
            }).then((document) => vscode.window.showTextDocument(document, {
                preview: false, // This will open the document in preview mode
                selection: new vscode.Selection(args.selectionStart, args.selectionEnd)
            }));

            vscode.window.showInformationMessage(`Opened new file: ${args.title}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Register the deleteInlineChat command
    const deleteInlineChatCommand = vscode.commands.registerCommand('gait-copilot.removeInlineChat', (args) => {
        console.log("Removing inline chat", args);
        Inline.removeInlineChat(args.filePath, args.inline_chat_id);
        redecorate(context);
    });

    // Register the deletePanelChat command
    const deletePanelChatCommand = vscode.commands.registerCommand('gait-copilot.deletePanelChat', async () => {
        try {
            if (!workspaceFolder) {
                throw new Error('No workspace folder found');
            }

            const gaitDir = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
            const stashedPath = path.join(gaitDir, 'stashedPanelChats.json');

            if (!fs.existsSync(stashedPath)) {
                vscode.window.showErrorMessage('stashedPanelChats.json does not exist.');
                return;
            }

            // Read existing chats
            const fileContent = fs.readFileSync(stashedPath, 'utf-8');
            const chats: { messageText: string; responseText: string }[] = JSON.parse(fileContent);

            if (chats.length === 0) {
                vscode.window.showInformationMessage('No chats to delete.');
                return;
            }

            // Prompt user to select which chat to delete
            const items = chats.map((chat, index) => ({
                label: `Chat ${index + 1}`,
                description: `Message: ${chat.messageText.substring(0, 50)}..., Response: ${chat.responseText.substring(0, 50)}...`,
                index: index
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a chat to delete'
            });

            if (!selected) {
                return; // User cancelled the selection
            }

            // Confirm deletion
            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to delete ${selected.label}?`,
                { modal: true },
                'Yes'
            );

            if (confirm !== 'Yes') {
                return;
            }

            // Remove the selected chat
            chats.splice(selected.index, 1);

            // Write back the updated chats
            fs.writeFileSync(stashedPath, JSON.stringify(chats, null, 2));
            vscode.window.showInformationMessage(`Deleted ${selected.label} successfully.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Register commands to activate and deactivate decorations
    const activateDecorationsCommand = vscode.commands.registerCommand('gait-copilot.activateDecorations', () => {
        decorationsActive = true;
        redecorate(context);
        vscode.window.showInformationMessage('Decorations activated.');
    });

    const deactivateDecorationsCommand = vscode.commands.registerCommand('gait-copilot.deactivateDecorations', () => {
        decorationsActive = false;
        if (disposibleDecorations) {
            disposibleDecorations.decorationTypes.forEach(decoration => decoration.dispose());
            disposibleDecorations.hoverProvider.dispose();
            disposibleDecorations = undefined;
        }
        vscode.window.showInformationMessage('Decorations deactivated.');
    });

    // Register all commands
    context.subscriptions.push(
        updateSidebarCommand, 
        helloWorldCommand, 
        inlineChatStartOverride, 
        inlineChatContinue, 
        inlineChatAcceptOverride, 
        deleteInlineChatCommand, 
        openFileWithContentCommand,
        activateDecorationsCommand,
        deactivateDecorationsCommand,
        deletePanelChatCommand // Add the new command here
    );

    redecorate(context);
    vscode.window.onDidChangeActiveTextEditor(() => {
        redecorate(context);
    });
    vscode.workspace.onDidSaveTextDocument(() => {
        redecorate(context);
    });
}

/**
 * Deactivates the extension.
 */
export function deactivate() {}
