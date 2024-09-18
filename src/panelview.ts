import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import simpleGit, { SimpleGit } from 'simple-git';
import { MessageEntry } from './types';

type CommitData = {
  commitHash: string;
  date: Date;
  commitMessage: string;
  messages: MessageEntry[];
};

type UncommittedData = {
  messages: MessageEntry[];
};

type GitHistoryData = {
  commits: CommitData[];
  uncommitted: UncommittedData | null;
};

/**
 * Retrieves the Git commit history for a specified file, extracting only newly added messages per commit.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the target file within the repository.
 * @returns An object containing commit data with only newly added messages and any uncommitted changes.
 */
async function getGitHistory(repoPath: string, filePath: string): Promise<GitHistoryData> {
  const git: SimpleGit = simpleGit(repoPath);

  console.log("Starting getGitHistory");
  // Ensure the file exists in the repository
  const absoluteFilePath = path.resolve(repoPath, filePath);
  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`File not found: ${absoluteFilePath}`);
  }

  // Step 1: Get the commit history for the file with --follow to track renames
  // '--reverse' ensures commits are ordered from oldest to newest
  const logArgs = ['log', '--reverse', '--follow', '--pretty=format:%H%x09%an%x09%ad%x09%s', '--', filePath];

  let logData: string;
  try {
    logData = await git.raw(logArgs);
  } catch (error) {
    throw new Error(`Failed to retrieve git log: ${(error as Error).message}`);
  }

  const logLines = logData.split('\n').filter(line => line.trim() !== '');
  const allCommits: CommitData[] = [];
  let previousCount = 0; // To track the number of messages in the previous commit

  for (const line of logLines) {
    console.log("Processing Line: ", line);
    const [commitHash, authorName, dateStr, ...commitMsgParts] = line.split('\t');
    const commitMessage = commitMsgParts.join('\t');

    // Get the file content at this commit
    let fileContent: string;
    try {
      fileContent = await git.raw(['show', `${commitHash}:${filePath}`]);
    } catch (error) {
      console.warn(`Warning: Could not retrieve file at commit ${commitHash}. It might have been deleted or renamed.`);
      continue; // Skip this commit
    }

    // Parse the JSON content
    let parsedContent: MessageEntry[];
    try {
      parsedContent = JSON.parse(fileContent);
      if (!Array.isArray(parsedContent)) {
        // Handle non-array JSON structures if necessary
        console.warn(`Warning: Parsed content is not an array for commit ${commitHash}. Attempting to handle as object.`);
        if (parsedContent && typeof parsedContent === 'object') {
          parsedContent = [parsedContent as MessageEntry];
        } else {
          throw new Error('Parsed content is neither an array nor an object.');
        }
      }
    } catch (error) {
      console.warn(`Warning: Failed to parse JSON for commit ${commitHash}: ${(error as Error).message}`);
      console.warn(`Content: ${fileContent}`);
      continue; // Skip this commit
    }

    // Sanitize the parsedContent to ensure responseText is a string
    parsedContent = parsedContent.map(entry => ({
      ...entry,
      responseText: typeof entry.responseText === 'string' ? entry.responseText : ''
    }));

    const currentCount = parsedContent.length;
    const newMessages = parsedContent.slice(previousCount); // Extract only new messages
    previousCount = currentCount; // Update the previous count for the next iteration

    if (newMessages.length > 0) {
      const date = new Date(dateStr);

      allCommits.push({
        commitHash,
        date,
        commitMessage,
        messages: newMessages,
      });
    } else {
      console.log(`No new messages added in commit ${commitHash}`);
    }
  }

  // Step 2: Check for uncommitted changes
  let status;
  try {
    status = await git.status();
  } catch (error) {
    throw new Error(`Failed to retrieve git status: ${(error as Error).message}`);
  }

  let uncommitted: UncommittedData | null = null;
  console.log("Checking uncommitted changes");
  if (
    status.modified.includes(filePath) ||
    status.not_added.includes(filePath) ||
    status.created.includes(filePath)
  ) {
    // Get the current (uncommitted) file content
    console.log("stashedPanelChats.json is modified");
    let currentContent: string;
    try {
      currentContent = fs.readFileSync(absoluteFilePath, 'utf-8');
    } catch (error) {
      console.warn(`Warning: Failed to read current file content: ${(error as Error).message}`);
      currentContent = '[]'; // Default to empty array
    }

    // Parse the JSON content
    let parsedCurrent: MessageEntry[];
    try {
      parsedCurrent = JSON.parse(currentContent);
      if (!Array.isArray(parsedCurrent)) {
        // Handle non-array structures
        console.warn(`Warning: Parsed current content is not an array.`);
        if (parsedCurrent && typeof parsedCurrent === 'object') {
          parsedCurrent = [parsedCurrent as MessageEntry];
        } else {
          throw new Error('Parsed current content is neither an array nor an object.');
        }
      }
    } catch (error) {
      console.warn(`Warning: Failed to parse current JSON content: ${(error as Error).message}`);
      parsedCurrent = [];
    }

    // Sanitize the parsedCurrent to ensure responseText is a string
    parsedCurrent = parsedCurrent.map(entry => ({
      ...entry,
      responseText: typeof entry.responseText === 'string' ? entry.responseText : ''
    }));

    // Extract only new uncommitted messages
    const newUncommittedMessages = parsedCurrent.slice(previousCount);
    // Note: Since previousCount represents messages up to the latest commit,
    // slicing from previousCount gives us messages added after the latest commit.

    if (newUncommittedMessages.length > 0) {
      uncommitted = {
        messages: newUncommittedMessages,
      };
    }
  }
  console.log("Returning commits and uncommitted");
  console.log(allCommits);
  console.log(uncommitted);
  return {
    commits: allCommits,
    uncommitted,
  };
}


// Assuming getGitHistory and related types are imported or defined in the same file

export class PanelViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gait-copilot.panelView';

    private _view?: vscode.WebviewView;
    private _commits: CommitData[] = [];

    /**
     * Loads commits and integrates uncommitted changes into the commits array.
     */
    private async loadCommitsAndChats() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        const repoPath = workspaceFolder.uri.fsPath;
        const filePath = '.gait/stashedPanelChats.json'; // Replace with your actual file path relative to repo

        try {
            const gitHistory: GitHistoryData = await getGitHistory(repoPath, filePath);

            // Map CommitData from getGitHistory to the class's commit structure
            this._commits = gitHistory.commits.map(commit => ({
                commitHash: commit.commitHash,
                commitMessage: commit.commitMessage,
                date: new Date(commit.date),
                messages: commit.messages
            })).sort((a, b) => b.date.getTime() - a.date.getTime());

            // Handle uncommitted changes by appending them to the commits array
            if (gitHistory.uncommitted) {
                const uncommittedCommit: CommitData = {
                    commitHash: 'uncommitted',
                    commitMessage: 'Uncommitted Changes',
                    date: new Date(), // Current date and time
                    messages: gitHistory.uncommitted.messages
                };
                this._commits.unshift(uncommittedCommit); // Add to the beginning for visibility
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error loading git history: ${error.message}`);
            this._commits = [];
        }
    }

    /**
     * Updates the webview content by loading commits and integrating uncommitted changes.
     */
    public async updateContent() {
        await this.loadCommitsAndChats();
        if (this._view) {
            this._view.webview.postMessage({
                type: 'update',
                commits: this._commits
            });
        }
    }

    constructor(private readonly _context: vscode.ExtensionContext) {
        // Initialize by loading commits and chats
        this.loadCommitsAndChats().catch(error => {
            vscode.window.showErrorMessage(`Initialization error: ${(error as Error).message}`);
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'webviewReady':
                  vscode.window.showInformationMessage('Webview is ready.');
                    this.updateContent();
                    break;
                case 'deleteMessage':
                  vscode.window.showInformationMessage('Delete message command received.');
                    this.handleDeleteMessage(message.id);
                    break;
                default:
                  console.log('Received unknown command:', message.command);
                  break;
            }
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.updateContent();
            }
        });
    }

    /**
     * Handles the deletion of a message by its ID.
     * @param messageId - The ID of the message to delete.
     */
    private async handleDeleteMessage(messageId: string) {
        console.log(`Received request to delete message with ID: ${messageId}`);
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        const repoPath = workspaceFolder.uri.fsPath;
        const filePath = path.join(repoPath, '.gait', 'stashedPanelChats.json');

        try {
            // Read the current file content
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            let messages: MessageEntry[] = JSON.parse(fileContent);

            // Find the index of the message to delete
            const index = messages.findIndex(msg => msg.id === messageId);
            if (index === -1) {
                vscode.window.showErrorMessage(`Message with ID ${messageId} not found.`);
                return;
            }

            // Remove the message from the array
            messages.splice(index, 1);
            console.log(`Deleted message with ID: ${messageId}`);

            // Write the updated messages back to the file
            fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf-8');
            console.log(`Updated ${filePath} after deletion.`);

            // Optionally, commit the change to Git
            const git: SimpleGit = simpleGit(repoPath);
            await git.add(filePath);
            await git.commit(`Delete message with ID ${messageId}`);
            console.log(`Committed deletion of message ID ${messageId} to Git.`);

            vscode.window.showInformationMessage(`Message with ID ${messageId} has been deleted.`);

            // Refresh the webview content
            this.updateContent();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to delete message: ${error.message}`);
            console.error(`Error deleting message: ${error.stack}`);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
      const nonce = getNonce();
    
      return `
    <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 0;
      margin: 0;
    }
    .chat-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    .chat-header {
      background-color: var(--vscode-titleBar-activeBackground);
      color: var(--vscode-titleBar-activeForeground);
      padding: 10px;
      border-radius: 5px 5px 0 0;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .chat-header h2 {
      margin: 0;
    }
    .message-container {
      margin-bottom: 15px;
      position: relative;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 5px;
      padding: 10px;
      background-color: var(--vscode-editor-inactiveSelectionBackground);
    }
    .delete-button {
      position: absolute;
      top: 5px;
      right: 5px;
      background: transparent;
      border: none;
      color: red;
      font-weight: bold;
      cursor: pointer;
      font-size: 16px;
    }
    .message, .response {
      padding: 10px;
      border-radius: 5px;
      margin-bottom: 5px;
    }
    .message {
      background-color: var(--vscode-editor-selectionBackground);
    }
    .response {
      background-color: var(--vscode-editorWidget-background);
    }
    .code-block {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 8px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      white-space: pre-wrap;
    }
    details {
      margin-bottom: 15px;
    }
    summary {
      cursor: pointer;
      padding: 5px;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 3px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    summary span {
      flex-grow: 1;
    }

    /* Modal Styles */
    .modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5); /* Semi-transparent background */
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000; /* Ensure it's on top */
    }

    .modal-content {
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 20px;
      border-radius: 8px;
      width: 300px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .modal-buttons {
      display: flex;
      justify-content: flex-end;
      margin-top: 20px;
    }

    .modal-buttons button {
      margin-left: 10px;
      padding: 5px 10px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    #confirmYes {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    #confirmNo {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="chat-header">
      <h2>Git Commit History</h2>
    </div>
    <div id="content"></div>
  </div>

  <!-- Confirmation Modal -->
  <div id="confirmModal" class="modal" style="display: none;">
    <div class="modal-content">
      <p>Are you sure you want to delete this message?</p>
      <div class="modal-buttons">
        <button id="confirmYes">Yes</button>
        <button id="confirmNo">No</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  function escapeHtml(text) {
      const map = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;'
      };
      return text.replace(/[&<>"']/g, function(m) { return map[m]; });
  }

  window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'update') {
          const contentElement = document.getElementById('content');
          let htmlContent = '';

          if (message.commits && Array.isArray(message.commits)) {
              message.commits.forEach(commit => {
                  if (commit.messages && commit.messages.length > 0) {
                      htmlContent += \`
                          <details>
                              <summary>\${escapeHtml(commit.commitMessage)} <span style="color: var(--vscode-descriptionForeground); font-size: 0.9em;">(\${new Date(commit.date).toLocaleString()})</span></summary>
                              <div class="message-container">
                                  \${formatChats(commit.messages)}
                              </div>
                          </details>
                      \`;
                  }
              });
          }

          contentElement.innerHTML = htmlContent;
      }
  });

  function formatChats(chats) {
      if (!Array.isArray(chats)) return '<em>No chats available for this commit.</em>';
      return chats.map(chat => {
          return \`
              <div class="message-container">
                  <button class="delete-button" data-id="\${chat.id}">×</button>
                  <div class="message">\${escapeHtml(chat.messageText)}</div>
                  <div class="response">
                      \${formatResponse(chat.responseText)}
                  </div>
              </div>
          \`;
      }).join('');
  }

  function formatResponse(responseText) {
      if (typeof responseText !== 'string') {
          console.warn('formatResponse received non-string responseText:', responseText);
          return '<em>Invalid response text.</em>';
      }
      return formatSingleResponse(responseText);
  }

  function formatSingleResponse(text) {
      if (typeof text !== 'string') {
          console.warn('formatSingleResponse received non-string text:', text);
          return '<em>Invalid response text.</em>';
      }

      const codeBlockRegex = /\`\`\`([^\`]+)\`\`\`/g;
      let formattedText = '';
      let lastIndex = 0;
      let match;

      while ((match = codeBlockRegex.exec(text)) !== null) {
          const index = match.index;
          formattedText += escapeHtml(text.slice(lastIndex, index));
          formattedText += \`<div class="code-block">\${escapeHtml(match[1].trim())}</div>\`;
          lastIndex = index + match[0].length;
      }

      formattedText += escapeHtml(text.slice(lastIndex));
      return formattedText;
  }

  // Event delegation for delete buttons
  document.getElementById('content').addEventListener('click', function(event) {
      var deleteButton = event.target.closest('.delete-button');
      if (deleteButton) {
          var messageId = deleteButton.getAttribute('data-id');
          console.log('Delete button clicked for message ID: ' + messageId);
          if (messageId) {
              showConfirmationModal(messageId);
          } else {
              console.warn('Delete button clicked without a valid message ID.');
          }
      }
  });

  // Function to show the custom confirmation modal
  function showConfirmationModal(messageId) {
      const modal = document.getElementById('confirmModal');
      modal.style.display = 'flex';

      // Handle "Yes" button click
      document.getElementById('confirmYes').onclick = function() {
          console.log('Sending deleteMessage command for ID: ' + messageId);
          vscode.postMessage({ command: 'deleteMessage', id: messageId });
          modal.style.display = 'none';
      };

      // Handle "No" button click
      document.getElementById('confirmNo').onclick = function() {
          console.log('Deletion cancelled by user.');
          modal.style.display = 'none';
      };
  }

  // Optional: Close the modal when clicking outside of the modal content
  window.onclick = function(event) {
      const modal = document.getElementById('confirmModal');
      if (event.target == modal) {
          modal.style.display = 'none';
      }
  };

  // Notify the extension that the Webview is ready
  vscode.postMessage({ command: 'webviewReady' });
  console.log('Webview is ready.');
  </script>
</body>
</html>
      `;
    }

}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
