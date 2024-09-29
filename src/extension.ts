import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as Inline from './inline';
import * as InlineDecoration from './filedecoration';
import { PanelViewProvider } from './panelview';
import { monitorPanelChatAsync } from './panelChats';
import * as VSCodeReader from './vscode/vscodeReader';
import { panelChatsToMarkdown } from './markdown';
import * as CursorReader from './cursor/cursorReader';
import { activateGaitParticipant } from './vscode/gaitChatParticipant';
import { checkTool, TOOL } from './ide';
import { PanelChatMode, StateReader } from './types';
import { generateKeybindings } from './keybind';
import { handleMerge } from './automerge';
import {diffLines} from 'diff';
import { getRelativePath } from './utils';
import { readStashedStateFromFile, writeStashedState, readStashedState, writeStashedStateToFile } from './stashedState';

const GAIT_FOLDER_NAME = '.gait';

let disposibleDecorations: { decorationTypes: vscode.Disposable[], hoverProvider: vscode.Disposable } | undefined;
let decorationsActive = false;

let isRedecorating = false;
let changeQueue: { cursor_position: vscode.Position, 
    document_uri: string, 
    changes: vscode.TextDocumentContentChangeEvent[], 
    timestamp: number,
    document_content: string | null }[] = [];

let fileState: { [key: string]: string } = {};

function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    return (...args: Parameters<F>): void => {
        if (timeout !== null) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => func(...args), waitFor);
    };
}


function getFileContent(file_path: string): string {
    if (fileState[file_path]) {
        //console.log("File content from fileState:", fileState[file_path]);
        return fileState[file_path];
    } else {
        // Read the file content from the file system
        try {
            //console.log("Reading file from file system:", file_path);
            return fs.readFileSync(file_path, 'utf8');
        } catch (error) {
            console.error(`Error reading file ${file_path}: ${error}`);
            return '';
        }
    }
}
/**
 * Handles file changes to detect AI-generated changes.
 */
async function handleFileChange(event: vscode.TextDocumentChangeEvent, stateReader: StateReader, context: vscode.ExtensionContext) {
    const changes = event.contentChanges;
    const editor = vscode.window.activeTextEditor;
    // Check if the file is in the workspace directory
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found. Extension failed.');
        return; // No workspace folder open
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;
    const filePath = event.document.uri.fsPath;

    if (!filePath.startsWith(workspacePath)) {
        console.log(`File ${filePath} is not in the workspace directory`);
        return; // File is not in the workspace directory
    }
    if (!event.document.fileName || event.reason || !editor || changes.length === 0 || event.document.fileName.includes(path.join(GAIT_FOLDER_NAME)) || event.document.fileName.includes("rendererLog")){
        return;
    }

    const currentCursorPosition = editor.selection.active;
    const lastCursorPosition = changeQueue.length > 0 ? changeQueue[changeQueue.length - 1].cursor_position : null;
    const isCursorMoved = lastCursorPosition && !lastCursorPosition.isEqual(currentCursorPosition);

    // Check if changes are AI-generated
    const isAIChange = changes.some(change => change.text.length > 3 && !isCursorMoved); // Example threshold for AI-generated change
    // Check if the change is not from clipboard paste
    const clipboardContent = await vscode.env.clipboard.readText();
    const isClipboardPaste = changes.some(change => change.text === clipboardContent);
    if (!isClipboardPaste && isAIChange) {
        const timestamp = Date.now();
        changeQueue.push({
            cursor_position: currentCursorPosition,
            document_uri: getRelativePath(event.document),
            changes: [...changes],
            timestamp,
            document_content: getFileContent(event.document.uri.fsPath),
        });
    }
    const file_path: string = getRelativePath(event.document);
    fileState[file_path] = event.document.getText();
}

function triggerAccept(stateReader: StateReader, context: vscode.ExtensionContext) {
    // Check if there are changes in the queue
    if (changeQueue.length > 0) {
        const lastChange = changeQueue[changeQueue.length - 1];
        const currentTime = Date.now();
        
        if (currentTime - lastChange.timestamp > 1000) {
            // Print out the changeQueue
            //console.log("Current changeQueue:");
            changeQueue.forEach((change, index) => {
                //console.log(`Change ${index + 1}:`);
                //console.log(`  Cursor Position: ${change.cursor_position.line}:${change.cursor_position.character}`);
                //console.log(`  Document URI: ${change.document_uri}`);
                //console.log(`  Timestamp: ${new Date(change.timestamp).toISOString()}`);
                //console.log(`  Changes:`);
                change.changes.forEach((c, i) => {
                    //console.log(`    Change ${i + 1}:`);
                    //console.log(`      Range: ${c.range.start.line}:${c.range.start.character} - ${c.range.end.line}:${c.range.end.character}`);
                    //console.log(`      Text: ${c.text}`);
                });
            });
            // Get the file content for each changed file
            const changedFiles = new Set(changeQueue.map(change => change.document_uri));

            const beforeFileContents: { [key: string]: string } = {};
            changeQueue.forEach(change => {
                if (change.document_content && !beforeFileContents[change.document_uri]) {
                    beforeFileContents[change.document_uri] = change.document_content;
                }
            });
            changeQueue = [];
            // Get the current file content for each changed file
            const afterFileContents: { [key: string]: string } = {};
            changedFiles.forEach(filePath => {
                const document = vscode.workspace.textDocuments.find(doc => getRelativePath(doc) === filePath);
                if (document) {
                    afterFileContents[filePath] = document.getText();
                } else {
                    console.error(`Document not found for file: ${filePath}`);
                    afterFileContents[filePath] = '';
                }
            });
            // Calculate file diffs
            const fileDiffs: Inline.FileDiff[] = [];
            changedFiles.forEach(filePath => {
                try {
                    const before = beforeFileContents[filePath];
                    const after = afterFileContents[filePath];
                    const diffs = diffLines(before, after);
                    fileDiffs.push({
                        file_path: filePath,
                        before_content: before,
                        after_content: after,
                        diffs: diffs,
                    });
                } catch (error) {
                    console.error(`Error processing file ${filePath}: ${error}`);
                }
            });
            //console.log("File Diffs:");
            fileDiffs.forEach((diff, index) => {
                //console.log(`File ${index + 1}: ${diff.file_path}`);
                //console.log("Diffs:");
                diff.diffs.forEach((change, changeIndex) => {
                    if (change.added) {
                        //console.log(`  Added Change ${changeIndex + 1}:`);
                        //console.log(`    ${change.value.replace(/\n/g, "\n    ")}`);
                    }
                });
            });

            console.log("Accepting inline AI change");
            stateReader.pushFileDiffs(fileDiffs);
        }
    }
}

/**
 * Function to redecorate the editor with debounce.
 */
const debouncedRedecorate = debounce((context: vscode.ExtensionContext) => {
    if (isRedecorating) {return;}
    isRedecorating = true;

    if (disposibleDecorations) {
        disposibleDecorations.decorationTypes.forEach(decoration => decoration.dispose());
        disposibleDecorations.hoverProvider.dispose();
    }

    disposibleDecorations = InlineDecoration.decorateActive(context, decorationsActive);

    isRedecorating = false;
}, 300); // 300ms debounce time

/**
 * Creates the .gait folder and necessary files if they don't exist.
 */
function createGaitFolderIfNotExists(workspaceFolder: vscode.WorkspaceFolder) {
    const gaitFolderPath = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
    if (!fs.existsSync(gaitFolderPath)) {
        fs.mkdirSync(gaitFolderPath);
        vscode.window.showInformationMessage(`${GAIT_FOLDER_NAME} folder created successfully`);
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
    const tool: TOOL = checkTool();
    const panelChatMode: PanelChatMode = 'OnlyMatchedChats';
    // Set panelChatMode in extension workspaceStorage
    context.workspaceState.update('panelChatMode', panelChatMode);

    writeStashedState(context, readStashedStateFromFile());
    context.workspaceState.update('fileStashedState', readStashedStateFromFile());
    //console.log(`PanelChatMode set to: ${panelChatMode}`);
    vscode.window.showInformationMessage(`PanelChatMode set to: ${panelChatMode}`);
    generateKeybindings(context, tool);

    const startInlineCommand = tool === "Cursor" ? "aipopup.action.modal.generate" : "inlineChat.start";
    const startPanelCommand = tool === "Cursor" ? "aichat.newchataction" : "workbench.action.chat.openInSidebar";

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found. Extension activation failed.');
        return;
    }
    try {
        createGaitFolderIfNotExists(workspaceFolder);
    } catch (error) {
        console.log("Error creating .gait folder", error);
    }

    const stateReader: StateReader = tool === 'Cursor' ? new CursorReader.CursorReader(context) : new VSCodeReader.VSCodeReader(context);

    setTimeout(() => {
        monitorPanelChatAsync(stateReader, context);
    }, 3000); // Delay to ensure initial setup

    const provider = new PanelViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PanelViewProvider.viewType, provider, { webviewOptions: { retainContextWhenHidden: true } })
    );

    //console.log('WebviewViewProvider registered for', PanelViewProvider.viewType);

    const updateSidebarCommand = vscode.commands.registerCommand('gait-copilot.updateSidebar', async () => {
        vscode.window.showInformationMessage('Updating sidebar content');
        try {
            provider.updateContent();
        } catch (error) {
            vscode.window.showErrorMessage(`Error updating sidebar: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const inlineChatStartOverride = vscode.commands.registerCommand('gait-copilot.startInlineChat', () => {
        // Display an information message
        vscode.window.showInformationMessage('Starting inline chat...');
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
            stateReader.startInline(inlineStartInfo).catch((error) => {
                vscode.window.showErrorMessage(`Failed to initialize extension: ${error instanceof Error ? error.message : 'Unknown error'}`);
            });
        }
        vscode.commands.executeCommand(startInlineCommand);
    });

    const setPanelChatModeCommand = vscode.commands.registerCommand('gait-copilot.setPanelChatMode', async () => {
        const options: vscode.QuickPickItem[] = [
            { label: 'Add All Chats', description: 'Save all panel chats' },
            { label: 'Add Selected Chats', description: 'Only save panel chats that match code ' }
        ];

        const selectedOption = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select Panel Chat Mode'
        });

        if (selectedOption) {
            const mode: PanelChatMode = selectedOption.label === 'Add All Chats' ? 'AddAllChats' : 'OnlyMatchedChats';
            context.workspaceState.update('panelChatMode', mode);
            vscode.window.showInformationMessage(`Panel Chat Mode set to: ${selectedOption.label}`);
        }
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
                stateReader.startInline(inlineStartInfo).catch((error) => {
                    vscode.window.showErrorMessage(`Failed to initialize extension: ${error instanceof Error ? error.message : 'Unknown error'}`);
                });
                vscode.commands.executeCommand(startInlineCommand);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to continue inline chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
        //console.log("Removing inline chat", args);
        Inline.removeInlineChat(context, args.inline_chat_id);
        debouncedRedecorate(context);
    });

    // Register the deletePanelChat command
    const deletePanelChatCommand = vscode.commands.registerCommand('gait-copilot.deletePanelChat', async () => {
        try {
            if (!workspaceFolder) {
                throw new Error('No workspace folder found');
            }

            const gaitDir = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
            const stashedPath = path.join(gaitDir, 'stashedPanelChats.json.gz');

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

    // Register command to convert PanelChats to markdown and open in a new file
    const exportPanelChatsToMarkdownCommand = vscode.commands.registerCommand('gait-copilot.exportPanelChatsToMarkdown', async (args) => {
        try {
            const markdownContent = panelChatsToMarkdown(args.chats, true);
            const filePath = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', 'context_gait.md');
            fs.writeFileSync(filePath, markdownContent, 'utf8');
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), { viewColumn: vscode.ViewColumn.Beside });
            vscode.window.showInformationMessage('Panel chats exported to context.gait successfully.');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export panel chats: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const registerGaitChatParticipantCommand = vscode.commands.registerCommand('gait-copilot.registerGaitChatParticipant', (args) => {
        //console.log("Registering gait chat participant", args);
        try {
            activateGaitParticipant(context, args.contextString);
            vscode.window.showInformationMessage('Gait chat participant loaded with edit history!');
            vscode.commands.executeCommand(startPanelCommand);
        } catch (error) {
            //console.log("Error registering gait chat participant", error);
            vscode.window.showErrorMessage(`Failed to register gait chat participant: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const toggleDecorationsCommand = vscode.commands.registerCommand('gait-copilot.toggleDecorations', () => {
        decorationsActive = !decorationsActive;
        if (decorationsActive) {
            debouncedRedecorate(context);
            vscode.window.showInformationMessage('Gait context activated.');
        } else {
            if (disposibleDecorations) {
                disposibleDecorations.decorationTypes.forEach(decoration => decoration.dispose());
                disposibleDecorations.hoverProvider.dispose();
                disposibleDecorations = undefined;
            }
            vscode.window.showInformationMessage('Gait context deactivated.');
        }
    });

    const handleMergeCommand = vscode.commands.registerCommand('gait-copilot.handleMerge', () => {
        handleMerge(context);
    });

    // Register all commands
    context.subscriptions.push(
        updateSidebarCommand, 
        inlineChatStartOverride, 
        inlineChatContinue, 
        deleteInlineChatCommand, 
        openFileWithContentCommand,
        toggleDecorationsCommand,
        deletePanelChatCommand,
        registerGaitChatParticipantCommand, // Add the new command here
        exportPanelChatsToMarkdownCommand,
        handleMergeCommand,
        setPanelChatModeCommand
    );

    debouncedRedecorate(context);
    vscode.window.onDidChangeActiveTextEditor(() => {
        debouncedRedecorate(context);
    });
    
    vscode.workspace.onDidSaveTextDocument(() => {
        debouncedRedecorate(context);
    });

    // Add a new event listener for text changes
    vscode.workspace.onDidChangeTextDocument((event) => {
        handleFileChange(event, stateReader, context);
        debouncedRedecorate(context);
    });

    // Set up an interval to trigger accept every second
    const acceptInterval = setInterval(async () => {
        try {
            triggerAccept(stateReader, context);
            await stateReader.matchPromptsToDiff();
        } catch (error) {
            console.log("Error in accept interval", error);
        }
    }, 1000);

    // Make sure to clear the interval when the extension is deactivated
    context.subscriptions.push({
        dispose: () => clearInterval(acceptInterval)
    });
}

/**
 * Deactivates the extension.
 */
export function deactivate() {}
