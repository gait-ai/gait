import { GAIT_FOLDER_NAME } from "./constants";
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import simpleGit from "simple-git";
import * as child_process from 'child_process';
import { getWorkspaceFolderPath } from './utils';

function mergeDriver(workspaceFolder: vscode.WorkspaceFolder){
    try {
        const gaitFolderPath = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);        // Define the custom merge driver script content
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
}

/**
 * Creates the .gait folder and necessary files if they don't exist.
 */
 function createGaitFolderIfNotExists(workspaceFolder: vscode.WorkspaceFolder) {
    const gaitFolderPath = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
    if (!fs.existsSync(gaitFolderPath)) {
        fs.mkdirSync(gaitFolderPath);
        vscode.window.showInformationMessage(`${GAIT_FOLDER_NAME} folder created successfully. Please commit this folder to save your chats.`);
    }

    setTimeout(async () => {
        try {
            const git = simpleGit(workspaceFolder.uri.fsPath);
            await git.add(GAIT_FOLDER_NAME);
        } catch (error) {
            console.error('Error adding .gait folder to Git:', error);
            vscode.window.showErrorMessage('Failed to add .gait folder to Git tracking');
        }
    }, 1000);

    const gitAttributesPath = path.join(workspaceFolder.uri.fsPath, '.gitattributes');
    const gitAttributesContent = fs.existsSync(gitAttributesPath)
        ? fs.readFileSync(gitAttributesPath, 'utf-8')
        : '';

    if (!gitAttributesContent.includes(`${GAIT_FOLDER_NAME}/** -diff linguist-generated`)) {
        fs.appendFileSync(gitAttributesPath, `\n${GAIT_FOLDER_NAME}/** -diff linguist-generated\n`);
        vscode.window.showInformationMessage('.gitattributes updated successfully');
    }
}



export async function initializeGait() {
    try {
        const workspacePath = getWorkspaceFolderPath();
        const gaitFolderPath = path.join(workspacePath, '.gait');
        
        if (workspacePath) {
            const workspaceFolder: vscode.WorkspaceFolder = { uri: vscode.Uri.file(workspacePath), name: path.basename(workspacePath), index: 0 };
            createGaitFolderIfNotExists(workspaceFolder);
            mergeDriver(workspaceFolder);
        } else {
            throw new Error('No workspace folder found');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to initialize Gait: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
