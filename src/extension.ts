import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as Diff from 'diff';
import * as Inline from './inline';
import * as InlineDecoration from './inlinedecoration';
import { PanelViewProvider } from './panelview';
import { monitorPanelChatAsync } from './panelChats';
import { readVSCodeState } from './tools/dbReader';
import * as VSCodeReader from './vscode/vscodeReader';
import { activateGaitParticipant } from './vscode/gaitChatParticipant';
import { checkTool } from './ide';

const GAIT_FOLDER_NAME = '.gait';

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
    vscode.window.showInformationMessage('Gait Copilot extension activated for ' + checkTool());

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
            const interactiveSessions = context.workspaceState.get('interactive.sessions', []);
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
            VSCodeReader.initializeAsync(context).catch((error) => {
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

                VSCodeReader.initializeAsync(context).catch((error) => {
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
            VSCodeReader.processEditorContent(context, editor).catch(error => {
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

    // Register command to activate gait chat participant
    const registerGaitChatParticipantCommand = vscode.commands.registerCommand('gait-copilot.registerGaitChatParticipant', (args) => {
        console.log("Registering gait chat participant", args);
        try {
            activateGaitParticipant(context, args.contextString);
            vscode.window.showInformationMessage('Gait chat participant loaded with edit history!');
            vscode.commands.executeCommand('workbench.action.chat.openInSidebar');
        } catch (error) {
            console.log("Error registering gait chat participant", error);
            vscode.window.showErrorMessage(`Failed to register gait chat participant: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

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
        deletePanelChatCommand,
        registerGaitChatParticipantCommand // Add the new command here
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
