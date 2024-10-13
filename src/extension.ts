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
import { checkTool, TOOL } from './ide';
import { AIChangeMetadata, PanelChat, PanelChatMode, StashedState, StateReader } from './types';
import { generateKeybindings } from './keybind';
import { handleMerge } from './automerge';
import {diffLines} from 'diff';
import { getRelativePath, updateTotalRepoLineCount } from './utils';
import { readStashedStateFromFile, writeStashedState, readStashedState, removePanelChatFromStashedState } from './stashedState';
import * as child_process from 'child_process';
import posthog from 'posthog-js';
import { identifyRepo, identifyUser } from './identify_user';
import simpleGit from 'simple-git';
import { addGaitSearchExclusion } from './setup/exclude_search';
import { getGitHistory, GitHistoryData } from './panelgit';
import { STASHED_GAIT_STATE_FILE_NAME } from './constants';

posthog.init('phc_vosMtvFFxCN470e8uHGDYCD6YuuSRSoFoZeLuciujry',
    {
        api_host: 'https://us.i.posthog.com',
        person_profiles: 'always' // or 'always' to create profiles for anonymous users as well
    }
);

const GAIT_FOLDER_NAME = '.gait';

let disposibleDecorations: vscode.Disposable[] = [];
let decorationsActive = false;
let timeOfLastDecorationChange = Date.now();

let isRedecorating = false;
let changeQueue: { cursor_position: vscode.Position, 
    document_uri: string, 
    changes: vscode.TextDocumentContentChangeEvent[], 
    timestamp: number, 
    document_content: string | null }[] = [];
let triggerAcceptCount = 0;
let lastInlineChatStart: Inline.InlineStartInfo | null = null;
let lastPanelChatNum: number = 0;

let fileState: { [key: string]: string } = {};
let gitHistory: GitHistoryData | null = null;
let hoverDecorationTypes: vscode.Disposable[] = [];

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
async function handleFileChange(event: vscode.TextDocumentChangeEvent) {
    const changes = event.contentChanges;
    
    const editor = vscode.window.activeTextEditor;
    // Check if the file is in the workspace directory
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        // vscode.window.showInformationMessage('Open a workspace to use gait!');
        return; // No workspace folder open
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;
    const filePath = event.document.uri.fsPath;


    if (!filePath.startsWith(workspacePath)) {
        // console.log(`File ${filePath} is not in the workspace directory`);
        return; // File is not in the workspace directory
    }
    if (!event.document.fileName || event.reason || !editor || changes.length === 0 || event.document.fileName.includes(path.join(GAIT_FOLDER_NAME)) || event.document.fileName.includes("rendererLog")){
        return;
    }

    const currentCursorPosition = editor.selection.active;
    const lastCursorPosition = changeQueue.length > 0 ? changeQueue[changeQueue.length - 1].cursor_position : null;
    const isCursorMoved = lastCursorPosition && !lastCursorPosition.isEqual(currentCursorPosition);

    // Check if changes are AI-generated
    const isAIChange = changes.some(change => change.text.length > 5 && !isCursorMoved); // Example threshold for AI-generated change
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

async function triggerAccept(stateReader: StateReader, context: vscode.ExtensionContext) {
    // Check if there are changes in the queue
    if (changeQueue.length > 0) {
        const lastChange = changeQueue[changeQueue.length - 1];
        const currentTime = Date.now();
        if (currentTime - lastChange.timestamp > 1500) {
            
            // Print out the changeQueue
            // Get the file content for each changed file
            const changedFiles = new Set(changeQueue.map(change => change.document_uri));

            const beforeFileContents: { [key: string]: string } = {};
            changeQueue.forEach(change => {
                if (!beforeFileContents[change.document_uri]) {
                    beforeFileContents[change.document_uri] = change.document_content || '';
                }
            });
            changeQueue = [];
            // Get the current file content for each changed file
            const afterFileContents: { [key: string]: string } = {};
            // Wait for 1 second
            await new Promise(resolve => setTimeout(resolve, 1000));
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
                        diffs: diffs,
                    });
                } catch (error) {
                    console.error(`Error processing file ${filePath}: ${error}`);
                }
            });
            // Extract the position where changes start if only one file is modified
            let changeStartPosition: vscode.Position | undefined;
            if (fileDiffs.length === 1) {
                const diff = fileDiffs[0];
                const firstAddedChange = diff.diffs.find(change => change.added);
                if (firstAddedChange) {
                    const linesBefore = diff.diffs
                        .slice(0, diff.diffs.indexOf(firstAddedChange))
                        .reduce((sum, change) => sum + (change.count || 0), 0);
                    changeStartPosition = new vscode.Position(linesBefore, 0);
                }
            }
            let inlineChatStart: Inline.InlineStartInfo | undefined = undefined; 
            const inlineData:Inline.InlineStartInfo | null = context.workspaceState.get('lastInlineChatStart')?? lastInlineChatStart;
            if (inlineData && fileDiffs.length === 1 && changeStartPosition) {
                if (inlineData.fileName === fileDiffs[0].file_path &&
                    currentTime - new Date(inlineData.startTimestamp).getTime() < 60000 &&
                    changeStartPosition.line >= inlineData.startSelection.line &&
                    changeStartPosition.line <= inlineData.startSelection.line + 10) {
                    inlineChatStart = inlineData;
                }
                context.workspaceState.update('lastInlineChatStart', null);
                lastInlineChatStart = null;
            }
            
            const metadata: AIChangeMetadata = {
                changeStartPosition: changeStartPosition,
                inlineChatStartInfo: inlineChatStart,
            };
            stateReader.pushFileDiffs(fileDiffs, metadata);
        }
    }
}

/**
 * Function to redecorate the editor with debounce.
 */
const debouncedRedecorate = debounce((context: vscode.ExtensionContext) => {
    isRedecorating = true;

    if (disposibleDecorations) {
        disposibleDecorations.forEach(decoration => decoration.dispose());
    }

    disposibleDecorations = InlineDecoration.decorateActive(context, gitHistory, decorationsActive);

    isRedecorating = false;
}, 300); // 300ms debounce time

/**
 * Creates the .gait folder and necessary files if they don't exist.
 */
 function createGaitFolderIfNotExists(workspaceFolder: vscode.WorkspaceFolder) {
    const gaitFolderPath = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
    if (!fs.existsSync(gaitFolderPath)) {
        fs.mkdirSync(gaitFolderPath);
        vscode.window.showInformationMessage(`${GAIT_FOLDER_NAME} folder created successfully. Please commit this folderto save your chats.`);
    }


    const gitAttributesPath = path.join(workspaceFolder.uri.fsPath, '.gitattributes');
    const gitAttributesContent = fs.existsSync(gitAttributesPath)
        ? fs.readFileSync(gitAttributesPath, 'utf-8')
        : '';

    if (!gitAttributesContent.includes(`${GAIT_FOLDER_NAME}/** -diff linguist-generated`)) {
        fs.appendFileSync(gitAttributesPath, `\n${GAIT_FOLDER_NAME}/** -diff linguist-generated\n`);
        vscode.window.showInformationMessage('.gitattributes updated successfully');
    }
}

/**
 * Activates the extension.
 */
export function activate(context: vscode.ExtensionContext) {
   const firstTime = context.globalState.get('firstTime', true);

    if (firstTime) {
        // Mark that it's no longer the first time
        context.globalState.update('firstTime', false);
        posthog.capture('user_download');

        // Open the onboarding directory
        const onboardingDir = vscode.Uri.joinPath(context.extensionUri, 'onboarding_dir');
        vscode.commands.executeCommand('vscode.openFolder', onboardingDir);

        // Open the onboarding file
        const onboardingFile = vscode.Uri.joinPath(context.extensionUri, 'onboarding_dir', 'onboarding.py');
        vscode.commands.executeCommand('vscode.open', onboardingFile);

        // Open the welcome markdown file
        const welcomeFile = vscode.Uri.joinPath(context.extensionUri, 'resources', 'welcome.md');
        vscode.commands.executeCommand('markdown.showPreview', welcomeFile);
    }
    
    const tool: TOOL = checkTool();
    // Set panelChatMode in extension workspaceStorage
    const panelChatMode = "OnlyMatchedChats";
    context.workspaceState.update('panelChatMode', panelChatMode);

    identifyUser();
    posthog.capture('activate_extension', {
        tool: tool,
    });



    generateKeybindings(context, tool);

    const startInlineCommand = tool === "Cursor" ? "aipopup.action.modal.generate" : "inlineChat.start";
    const startPanelCommand = tool === "Cursor" ? "aichat.newchataction" : "workbench.action.chat.openInSidebar";

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        // vscode.window.showInformationMessage('Open a workspace to use gait!');
        return;
    }

    try {
        createGaitFolderIfNotExists(workspaceFolder);
        setTimeout(async () => {
            try {
                const git = simpleGit(workspaceFolder.uri.fsPath);
                await git.add(GAIT_FOLDER_NAME);
            } catch (error) {
                console.error('Error adding .gait folder to Git:', error);
                vscode.window.showErrorMessage('Failed to add .gait folder to Git tracking');
            }
        }, 1);
    } catch (error) {
        vscode.window.showErrorMessage('fatal: unable to create gait folder!');
        posthog.capture('fatal_unable_to_create_gait_folder');
        console.log("Error creating .gait folder", error);
    }
    identifyRepo(context);
    const stateReader: StateReader = tool === 'Cursor' ? new CursorReader.CursorReader(context) : new VSCodeReader.VSCodeReader(context);

    writeStashedState(context, readStashedStateFromFile());
    context.workspaceState.update('stashedState', readStashedStateFromFile());
    setTimeout(async () => {
        monitorPanelChatAsync(stateReader, context);
        const filePath = `.gait/${STASHED_GAIT_STATE_FILE_NAME}`;
        gitHistory = await getGitHistory(context, workspaceFolder.uri.fsPath, filePath);
    }, 3000); // Delay to ensure initial setup

    const provider = new PanelViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PanelViewProvider.viewType, provider, { webviewOptions: { retainContextWhenHidden: true } })
    );

    //console.log('WebviewViewProvider registered for', PanelViewProvider.viewType);

    const inlineChatStartOverride = vscode.commands.registerCommand('gait.startInlineChat', () => {
        // Display an information message
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
            context.workspaceState.update('lastInlineChatStart', inlineStartInfo);
            lastInlineChatStart = inlineStartInfo;
        }
        vscode.commands.executeCommand(startInlineCommand);
    });

    const openFileWithContentCommand = vscode.commands.registerCommand('gait.openFileWithContent', async (args) => {
        try {
            // Create a new untitled document
            vscode.workspace.openTextDocument({
                content: args.content,
                language: args.languageId // You can change this to match the content type
            }).then((document) => vscode.window.showTextDocument(document, {
                preview: false, // This will open the document in preview mode
            }));

            vscode.window.showInformationMessage(`Opened new file: ${args.title}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Register the deleteInlineChat command
    const deleteInlineChatCommand = vscode.commands.registerCommand('gait.removeInlineChat', (args) => {
        //console.log("Removing inline chat", args);
        Inline.removeInlineChat(context, args.inline_chat_id);
        vscode.window.showInformationMessage("removed inline chat.");
        debouncedRedecorate(context);
    });

    // Register command to convert PanelChats to markdown and open in a new file
    const exportPanelChatsToMarkdownCommand = vscode.commands.registerCommand('gait.exportPanelChatsToMarkdown', async (args) => {
        try {
            const  panelChatId  = args.data;
            const continue_chat = args.continue_chat;

            // Retrieve the current panel chats from workspace state
            const currentPanelChats: PanelChat[] | undefined = context.workspaceState.get('currentPanelChats');
            if (!currentPanelChats) {
                throw new Error('No panel chats found in workspace state');
            }
            // Retrieve the stashed state from workspace state
            const stashedState: StashedState = readStashedState(context);

            const allPanelChats = [
                ...(currentPanelChats || []),
                ...stashedState.panelChats
            ];
            // Find the specific panel chat
            const panelChat = allPanelChats.find(chat => chat.id === panelChatId);
            if (!panelChat) {
                throw new Error(`Panel chat with ID ${panelChatId} not found`);
            }

            // Create the markdown data
            const markdownData = [{
                commit: args.commitInfo,
                panelChat: panelChat
            }];

            const markdownContent = panelChatsToMarkdown(markdownData, continue_chat);
            const filePath = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', 'gait_context.md');
            fs.writeFileSync(filePath, markdownContent, 'utf8');
            if (continue_chat){
                posthog.capture('continue_chat');
                await vscode.workspace.openTextDocument(filePath);
                await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(filePath));
                await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup');
            } else {
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), { viewColumn: vscode.ViewColumn.Beside });
            }
            await vscode.commands.executeCommand(startPanelCommand);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export panel chats: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const removePanelChatCommand = vscode.commands.registerCommand('gait.removePanelChat', (args) => {
        const stashedState = readStashedState(context);
        stashedState.deletedChats.deletedPanelChatIDs.push(args.panelChatId);        
        writeStashedState(context, stashedState);
        vscode.window.showInformationMessage("Deleted panel chat.");
        debouncedRedecorate(context);
    });

    const toggleHoverCommand = vscode.commands.registerCommand('gait.toggleHover', () => {
        decorationsActive = !decorationsActive;
        if (decorationsActive) {
            posthog.capture('activate_decorations', {
                time_deactivated: Date.now() - timeOfLastDecorationChange,
            });
            timeOfLastDecorationChange = Date.now();
            debouncedRedecorate(context);
            vscode.window.showInformationMessage('gait hover activated.');
        } else {
            posthog.capture('deactivate_decorations');
            if (disposibleDecorations) {
                timeOfLastDecorationChange = Date.now();
                posthog.capture('deactivate_decorations', {
                    time_activated: Date.now() - timeOfLastDecorationChange,
                });
                disposibleDecorations.forEach(decoration => decoration.dispose());
                disposibleDecorations = [];
            }
            vscode.window.showInformationMessage('gait hover deactivated.');
        }
    });

    // Make sure to clear the interval when the extension is deactivated


    try {
        const gaitFolderPath = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
        addGaitSearchExclusion();
        // Define the custom merge driver script content
        const customMergeDriverScript = `#!/bin/bash

# custom-merge-driver.sh

# Exit immediately if a command exits with a non-zero status
set -e

# Git passes these parameters to the merge driver
BASE="$1"    # %O - Ancestor's version (common base)
CURRENT="$2" # %A - Current version (ours)
OTHER="$3"   # %B - Other branch's version (theirs)

# Temporary file to store the merged result
MERGED="\${CURRENT}.merged"

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
    inlineChats: (ourState.inlineChats + theirState.inlineChats | group_by(.inline_chat_id) | map(.[0])),
    schemaVersion: ourState.schemaVersion,
    deletedChats: {
      deletedMessageIDs: (ourState.deletedChats.deletedMessageIDs + theirState.deletedChats.deletedMessageIDs) | unique,
      deletedPanelChatIDs: (ourState.deletedChats.deletedPanelChatIDs + theirState.deletedChats.deletedPanelChatIDs) | unique
    },
    kv_store: (ourState.kv_store + theirState.kv_store)
  };

mergeStashedStates($ourState; $theirState)
EOF

# Debug: Verify the jq filter content
echo "Using jq filter from $TMP_JQ_FILTER:"

# Perform the merge using jq with the temporary filter file
jq -n \
    --argfile ourState "$CURRENT" \
    --argfile theirState "$OTHER" \
    -f "$TMP_JQ_FILTER" > "$MERGED"

# Capture jq's exit status
JQ_STATUS=$?

# Check if the merge was successful
if [ "$JQ_STATUS" -ne 0 ]; then
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

            // vscode.window.showInformationMessage('Git merge driver configured successfully.');
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

        const mergeDriverAttribute = `${GAIT_FOLDER_NAME}/state.json merge=custom-stashed-state`;

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
        removePanelChatCommand,
        inlineChatStartOverride, 
        deleteInlineChatCommand, 
        openFileWithContentCommand,
        toggleHoverCommand,
        exportPanelChatsToMarkdownCommand,
    );

    debouncedRedecorate(context);
    vscode.window.onDidChangeActiveTextEditor(() => {
        debouncedRedecorate(context);
    });
    
    vscode.workspace.onDidSaveTextDocument(() => {
        debouncedRedecorate(context);
    });

    vscode.window.onDidChangeTextEditorSelection((event) => {
        if (gitHistory) {
            hoverDecorationTypes = InlineDecoration.addDecorationForLine(context, event.textEditor, event.selections[0].active.line, hoverDecorationTypes, gitHistory);
        }
    });

    // Add a new event listener for text changes
    vscode.workspace.onDidChangeTextDocument((event) => {
        handleFileChange(event);
        debouncedRedecorate(context);
    });

    // Set up an interval to trigger accept every second
    const acceptInterval = setInterval(async () => {
        try {
            await triggerAccept(stateReader, context);
            triggerAcceptCount++;
            if (triggerAcceptCount % 3 === 0) {
                const filePath = `.gait/${STASHED_GAIT_STATE_FILE_NAME}`;
                gitHistory = await getGitHistory(context, workspaceFolder.uri.fsPath, filePath);
                if (await stateReader.matchPromptsToDiff()) {
                    debouncedRedecorate(context);
                }
            }
            if (triggerAcceptCount % 4000 === 0) {
                triggerAcceptCount = 0;
            }
            if (lastPanelChatNum !== context.workspaceState.get('panelChatNum')) {
                lastPanelChatNum = context.workspaceState.get('panelChatNum') || 0;
                debouncedRedecorate(context);
            }
        } catch (error) {
            console.log("Error in accept interval", error);
        }
    }, 1000);

    context.subscriptions.push(
        vscode.commands.registerCommand('gait.showIndividualPanelChat', async (args) => {
            let panelChatId = args.panelChatId;
            if (!panelChatId) {
                // If no panelChatId is provided, prompt the user to enter one
                panelChatId = await vscode.window.showInputBox({
                    prompt: 'Enter the Panel Chat ID',
                    placeHolder: 'e.g., panel-chat-123'
                });
            }

            if (panelChatId) {
                provider.handleSwitchToIndividualView(panelChatId);
            } else {
                vscode.window.showErrorMessage('No Panel Chat ID provided.');
            }
        })
    );
    // Make sure to clear the interval when the extension is deactivated
    context.subscriptions.push({
        dispose: () => clearInterval(acceptInterval)
    });

    InlineDecoration.writeMatchStatistics(context);
    updateTotalRepoLineCount(context);
}

/**
 * Deactivates the extension.
 */
export function deactivate() {
    posthog.capture('deactivate');
}
