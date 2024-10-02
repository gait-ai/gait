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
import * as child_process from 'child_process';
import { STASHED_GAIT_STATE_FILE_NAME } from './constants';

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

    // Register command to convert PanelChats to markdown and open in a new file
    const exportPanelChatsToMarkdownCommand = vscode.commands.registerCommand('gait-copilot.exportPanelChatsToMarkdown', async (args) => {
        try {
            const decodedArgs = Buffer.from(args.data, 'base64').toString('utf-8');
            const markdownData = JSON.parse(decodedArgs);
            const continue_chat = args.continue_chat;
            const markdownContent = panelChatsToMarkdown(markdownData, continue_chat);
            const filePath = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', 'gait_context.md');
            fs.writeFileSync(filePath, markdownContent, 'utf8');
            if (continue_chat){
                await vscode.workspace.openTextDocument(filePath);
                await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(filePath));
                await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup');
            } else {
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), { viewColumn: vscode.ViewColumn.Beside });            }
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

    try {
        const gaitFolderPath = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);

        // Define the custom merge driver script content
        const customMergeDriverScript = `#!/bin/bash

# custom-merge-driver.sh

# Git passes these parameters to the merge driver
BASE="$1"    # %O - Ancestor's version (common base)
CURRENT="$2" # %A - Current version (ours)
OTHER="$3"   # %B - Other branch's version (theirs)

# Temporary file to store the merged result
MERGED="$CURRENT.merged"

# Check if jq is installed
if ! command -v jq &> /dev/null
then
    echo "jq command could not be found. Please install jq to use this merge driver."
    exit 1
fi

# Optional: Validate JSON inputs
if ! jq empty "$CURRENT" 2>/dev/null; then
    echo "Invalid JSON in CURRENT file: $CURRENT"
    exit 1
fi
if ! jq empty "$OTHER" 2>/dev/null; then
    echo "Invalid JSON in OTHER file: $OTHER"
    exit 1
fi

# Create a temporary file for the jq filter
TMP_JQ_FILTER=$(mktemp /tmp/jq_filter.XXXXXX)

# Ensure the temporary file is deleted on script exit
trap 'rm -f "$TMP_JQ_FILTER"' EXIT

# Write the jq script to the temporary file
cat <<'EOF' > "$TMP_JQ_FILTER"
def mergePanelChats(ourChats; theirChats):
  (ourChats + theirChats)
  | group_by(.id)
  | map(
      if length == 1 then .[0]
      else
        .[0] as $ourChat
        | .[1] as $theirChat
        | (if ($theirChat.messages | length) > ($ourChat.messages | length) then $theirChat.messages else $ourChat.messages end) as $mergedMessages
        | ($ourChat.kv_store + $theirChat.kv_store) as $mergedKvStore
        | {
            ai_editor: $ourChat.ai_editor,
            id: $ourChat.id,
            customTitle: $ourChat.customTitle,
            parent_id: $ourChat.parent_id,
            created_on: $ourChat.created_on,
            messages: $mergedMessages,
            kv_store: $mergedKvStore
          }
      end
    );

def mergeStashedStates(ourState; theirState):
  {
    panelChats: mergePanelChats(ourState.panelChats; theirState.panelChats),
    inlineChats: (ourState.inlineChats + theirState.inlineChats),
    schemaVersion: ourState.schemaVersion,
    deletedChats: {
      deletedMessageIDs: (ourState.deletedChats.deletedMessageIDs + theirState.deletedChats.deletedMessageIDs) | unique,
      deletedPanelChatIDs: (ourState.deletedChats.deletedPanelChatIDs + theirState.deletedChats.deletedPanelChatIDs) | unique
    },
    kv_store: ourState.kv_store + theirState.kv_store
  };

ourState = $ourState;
theirState = $theirState;

mergedState = mergeStashedStates(ourState; theirState);

mergedState
EOF

# Detect OS and set sed in-place edit flag accordingly
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS (BSD sed)
    SED_INPLACE=(-i '')
else
    # Assume GNU sed
    SED_INPLACE=(-i)
fi

# Debug: Verify the jq filter content
echo "Using jq filter from $TMP_JQ_FILTER:"
sed "\${SED_INPLACE[@]}" 's/\r$//' "$TMP_JQ_FILTER"

# Perform the merge using jq with the temporary filter file
jq -n \
    --argfile ourState "$CURRENT" \
    --argfile theirState "$OTHER" \
    -f "$TMP_JQ_FILTER" > "$MERGED"
    
# Capture jq's exit status
JQ_STATUS=$?

# Check if the merge was successful
if [ $? -ne 0 ]; then
    echo "Error during merging stashed states."
    exit 1
fi

# Replace the current file with the merged result
mv "$MERGED" "$CURRENT"

# Indicate a successful merge
exit 0
`;
        // Path to the custom merge driver script
        const customMergeDriverPath = path.join(gaitFolderPath, 'custom-merge-driver.sh');

        const gitignorePath = path.join(workspaceFolder.uri.fsPath, '.gitignore');
        let gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
        if (!gitignoreContent.includes('custom-merge-driver.sh')) {
            fs.appendFileSync(gitignorePath, '\n.gait/custom-merge-driver.sh\n');
            vscode.window.showInformationMessage('Added custom merge driver script to .gitignore');
        }


        // Write the script to the .gait folder if it doesn't exist or content has changed
        if (!fs.existsSync(customMergeDriverPath) || fs.readFileSync(customMergeDriverPath, 'utf8') !== customMergeDriverScript) {
            fs.writeFileSync(customMergeDriverPath, customMergeDriverScript, { mode: 0o755 });
            fs.chmodSync(customMergeDriverPath, 0o755); // Ensure the script is executable
            vscode.window.showInformationMessage('Custom merge driver script updated.');
        }

        // Configure Git to use the custom merge driver
        try {
            const gitConfigNameCmd = `git config --local merge.custom-stashed-state.name "Custom merge driver for stashed state"`;
            child_process.execSync(gitConfigNameCmd, { cwd: workspaceFolder.uri.fsPath });

            const gitConfigDriverCmd = `git config --local merge.custom-stashed-state.driver "${customMergeDriverPath} %O %A %B"`;
            child_process.execSync(gitConfigDriverCmd, { cwd: workspaceFolder.uri.fsPath });

            vscode.window.showInformationMessage('Git merge driver configured successfully.');
        } catch (error) {
            console.error('Error configuring git merge driver:', error);
            vscode.window.showErrorMessage('Failed to configure git merge driver.');
        }

        // Update the .gitattributes file
        const gitAttributesPath = path.join(workspaceFolder.uri.fsPath, '.gitattributes');
        let gitAttributesContent = '';
        if (fs.existsSync(gitAttributesPath)) {
            gitAttributesContent = fs.readFileSync(gitAttributesPath, 'utf8');
        }

        const mergeDriverAttribute = `${GAIT_FOLDER_NAME}/${STASHED_GAIT_STATE_FILE_NAME} merge=custom-stashed-state`;

        if (!gitAttributesContent.includes(mergeDriverAttribute)) {
            try {
                fs.appendFileSync(gitAttributesPath, `\n${mergeDriverAttribute}\n`);
                vscode.window.showInformationMessage('.gitattributes updated with custom merge driver.');
            } catch (error) {
                console.error('Error updating .gitattributes:', error);
                vscode.window.showErrorMessage('Failed to update .gitattributes with custom merge driver.');
            }
        }
    } catch (error) {
        console.error('Error setting up custom merge driver:', error);
        vscode.window.showErrorMessage('Failed to set up custom merge driver.');
    }

    // Register all commands
    context.subscriptions.push(
        updateSidebarCommand, 
        inlineChatStartOverride, 
        deleteInlineChatCommand, 
        openFileWithContentCommand,
        toggleDecorationsCommand,
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
