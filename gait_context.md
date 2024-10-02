# Panel Chats

Panel Chat Title: Markdown Formatting Issues in Chat Export
- **Created On**: 2024-10-02T04:59:44.850Z
- **Messages**:
    - **Model**: claude-3.5-sonnet
    - **Context**: /Users/kylel1/Documents/GitHub/gait-copilot/src/panelHover.ts
    - **Text**: why is the markdown broken in view in markdwon?
    - **Response**: The issue with the "View in Markdown" link is likely due to how the JSON data is being encoded in the command URI. Let's fix this by properly encoding the JSON data. Here's how we can update the relevant part of the code:

```typescript:src/panelHover.ts
// ... existing code ...

    const markdownData = {chats: [{commit: idToCommitInfo?.get(message.id), panelChat: panelChat}]};

    const exportCommand = vscode.Uri.parse(`command:gait-copilot.exportPanelChatsToMarkdown?${encodeURIComponent(JSON.stringify(markdownData))}`);
    markdown.appendMarkdown(`\n\n[View in Markdown](${exportCommand})`);

// ... existing code ...
```

The problem is that `JSON.stringify()` might produce a string with characters that are not safe for URIs, even after using `encodeURIComponent()`. To fix this, we should use a more robust encoding method. Here's an improved version:

```typescript:src/panelHover.ts
// ... existing code ...

    const markdownData = {chats: [{commit: idToCommitInfo?.get(message.id), panelChat: panelChat}]};

    const encodedData = Buffer.from(JSON.stringify(markdownData)).toString('base64');
    const exportCommand = vscode.Uri.parse(`command:gait-copilot.exportPanelChatsToMarkdown?${encodedData}`);
    markdown.appendMarkdown(`\n\n[View in Markdown](${exportCommand})`);

// ... existing code ...
```

This change does the following:

1. We convert the `markdownData` object to a JSON string.
2. We then convert this JSON string to a Base64-encoded string using `Buffer.from().toString('base64')`.
3. We use this Base64-encoded string directly in the command URI without additional encoding.

This approach ensures that all characters in the data are safely encoded for use in a URI, regardless of their original content. The `exportPanelChatsToMarkdown` command will need to be updated to decode this Base64 string back into JSON on the receiving end.

Make sure to update the command handler for `gait-copilot.exportPanelChatsToMarkdown` to decode the Base64 string before parsing it as JSON.
 - **Expanded Context** + Whole file in context:
 import * as vscode from 'vscode';
import { PanelMatchedRange } from './types';
import { getIdToCommitInfo } from './panelgit';

/**
 * Creates hover content for a matched panel chat range.
 * @param matchedRange The matched range containing the panel chat and message information.
 * @param document The VSCode text document.
 * @returns A promise that resolves to a VSCode Hover object.
 */
export async function createPanelHover(context: vscode.ExtensionContext, matchedRange: PanelMatchedRange, document: vscode.TextDocument): Promise<vscode.ProviderResult<vscode.Hover>> {
    let markdown = new vscode.MarkdownString();
    let idToCommitInfo = undefined;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.warn('No workspace folder found.');
    } else {
        try {
            const repoPath = workspaceFolder.uri.fsPath;
            const filePath = '.gait/stashedPanelChats.json.gz'; // Replace with your actual file path relative to repo
            idToCommitInfo = await getIdToCommitInfo(context, repoPath, filePath);
        } catch (error) {
            console.warn(`Error getting commit info for ${document.fileName}: ${error}`);
        }
    }
    const { panelChat, message_id } = matchedRange;

    // Find the message that resulted in the matched range
    const message = panelChat.messages.find(msg => msg.id === message_id);
    if (!message) {
        return undefined;
    }

    const commitInfo = idToCommitInfo?.get(message.id);
    const author = commitInfo?.author ?? "You";
    const commitMessage = commitInfo?.commitMessage ?? "Uncommited changes";

    markdown.isTrusted = true;

    // Display the message text and response
    const messageAuthor = commitInfo?.author ?? "You";
    markdown.appendMarkdown(`### ${messageAuthor}: ${message.messageText}\n\n`);
    // Escape backticks and newlines in the response text
    markdown.appendMarkdown(`**Response**: ${message.responseText}\n\n`);

    // Display the context information in small text
    if (message.context && message.context.length > 0) {
        markdown.appendMarkdown(`**Context**: ${message.context[0].value.human_readable}`);
        if (message.context.length > 1) {
            markdown.appendMarkdown(` (and ${message.context.length - 1} more)`);
        }
        markdown.appendMarkdown(`\n\n`);
    }

    markdown.appendMarkdown(`**Commit**: ${commitMessage} by ${author}\n\n`);
    const markdownData = [{commit: idToCommitInfo?.get(message.id), panelChat: panelChat}];

    const encodedData = Buffer.from(JSON.stringify(markdownData)).toString('base64');
    const exportCommand = vscode.Uri.parse(`command:gait-copilot.exportPanelChatsToMarkdown?${encodeURIComponent(JSON.stringify({data: encodedData}))}`);
    markdown.appendMarkdown(`\n\n[View in Markdown](${exportCommand}) | ` );
    markdown.appendMarkdown(`\n\n`);
    const deleteCommand = vscode.Uri.parse(`command:gait-copilot.removePanelChat?${encodeURIComponent(JSON.stringify({
        panel_chat_id: panelChat.id,
        message_id: message.id
    }))}`);
    markdown.appendMarkdown(`[Delete This Panel Chat Annotation](${deleteCommand})`);

    return new vscode.Hover(markdown);
}
    - **Model**: claude-3.5-sonnet
    - **Context**: /Users/kylel1/Documents/GitHub/gait-copilot/src/extension.ts
    - **Text**: how do I modify the exportPanelChatsToMarkdownCommand to decode thsi base64?
    - **Response**: To modify the `exportPanelChatsToMarkdownCommand` to decode the Base64 encoded data, you'll need to update the command handler. Here's how you can modify the relevant part of the code:

```typescript:src/extension.ts
// ... existing code ...

const exportPanelChatsToMarkdownCommand = vscode.commands.registerCommand('gait-copilot.exportPanelChatsToMarkdown', async (encodedArgs) => {
    try {
        const decodedArgs = Buffer.from(encodedArgs, 'base64').toString('utf-8');
        const markdownData = JSON.parse(decodedArgs);
        const markdownContent = panelChatsToMarkdown(markdownData.chats, true);
        const filePath = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', 'gait_context.md');
        fs.writeFileSync(filePath, markdownContent, 'utf8');
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), { viewColumn: vscode.ViewColumn.Beside });
        await vscode.commands.executeCommand(startPanelCommand);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to export panel chats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});

// ... rest of the code ...
```

This modification does the following:

1. The command now expects a single `encodedArgs` parameter, which is the Base64 encoded string.
2. It decodes the Base64 string back into a UTF-8 string using `Buffer.from(encodedArgs, 'base64').toString('utf-8')`.
3. The decoded string is then parsed as JSON to get the `markdownData` object.
4. The rest of the function remains the same, using `markdownData.chats` to generate the markdown content.

This change ensures that the command can handle the Base64 encoded data that you're now passing from the `panelHover.ts` file. Make sure that the `panelChatsToMarkdown` function is updated to work with the new structure of `markdownData.chats` if necessary.
 - **Expanded Context** + Whole file in context:
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
import { readStashedStateFromFile, writeStashedState, readStashedState } from './stashedState';

const GAIT_FOLDER_NAME = '.gait';

let disposibleDecorations: { decorationTypes: vscode.Disposable[], hoverProvider: vscode.Disposable } | undefined;
let decorationsActive = true;

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
    // Set panelChatMode in extension workspaceStorage
    const panelChatMode = "OnlyMatchedChats";
    context.workspaceState.update('panelChatMode', panelChatMode);

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

    writeStashedState(context, readStashedStateFromFile());
    context.workspaceState.update('fileStashedState', readStashedStateFromFile());
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
            const decodedArgs = Buffer.from(args.data, 'base64').toString('utf-8');
            const markdownData = JSON.parse(decodedArgs);
            const markdownContent = panelChatsToMarkdown(markdownData, true);
            const filePath = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', 'gait_context.md');
            fs.writeFileSync(filePath, markdownContent, 'utf8');
            await vscode.workspace.openTextDocument(filePath);
            await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(filePath));
            await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup');
            await vscode.commands.executeCommand(startPanelCommand);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export panel chats: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
        deleteInlineChatCommand, 
        openFileWithContentCommand,
        toggleDecorationsCommand,
        deletePanelChatCommand,
        exportPanelChatsToMarkdownCommand,
        handleMergeCommand,
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

