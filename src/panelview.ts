import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import {CommitData, GitHistoryData, getGitHistory, getGitHistoryThatTouchesFile} from './panelgit';
import { MessageEntry, StashedState, PanelChat, isStashedState } from './types';



export class PanelViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'gait-copilot.panelView';

  private _view?: vscode.WebviewView;
  private _commits: CommitData[] = [];
  private _isFilteredView: boolean = false; // New state to track view type

  /**
   * Loads commits and integrates uncommitted changes into the commits array.
   * Supports both default and filtered views based on _isFilteredView.
   */
  private async loadCommitsAndChats(additionalFilePath?: string) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found.');
        return;
    }

    const repoPath = workspaceFolder.uri.fsPath;
    const filePath = '.gait/stashedPanelChats.json'; // Replace with your actual file path relative to repo

    try {
        if (this._isFilteredView && additionalFilePath) {
            const gitHistory: GitHistoryData = await getGitHistoryThatTouchesFile(repoPath, filePath, additionalFilePath);

            // Map CommitData from getGitHistoryThatTouchesFile to the class's commit structure
            this._commits = gitHistory.commits.map(commit => ({
                commitHash: commit.commitHash,
                commitMessage: commit.commitMessage,
                author: commit.author,
                date: new Date(commit.date),
                panelChats: commit.panelChats // Updated to use panelChats
            })).sort((a, b) => b.date.getTime() - a.date.getTime());

            // Handle uncommitted changes by appending them to the commits array
            if (gitHistory.uncommitted) {
                const uncommittedCommit: CommitData = {
                    commitHash: 'uncommitted',
                    author: 'You',
                    commitMessage: 'Uncommitted Changes',
                    date: new Date(), // Current date and time
                    panelChats: gitHistory.uncommitted.panelChats // Updated to use panelChats
                };
                this._commits.unshift(uncommittedCommit); // Add to the beginning for visibility
            }
        } else {
            const gitHistory: GitHistoryData = await getGitHistory(repoPath, filePath);

            // Map CommitData from getGitHistory to the class's commit structure
            this._commits = gitHistory.commits.map(commit => ({
                commitHash: commit.commitHash,
                commitMessage: commit.commitMessage,
                author: commit.author,
                date: new Date(commit.date),
                panelChats: commit.panelChats // Updated to use panelChats
            })).sort((a, b) => b.date.getTime() - a.date.getTime());

            // Handle uncommitted changes by appending them to the commits array
            if (gitHistory.uncommitted) {
                const uncommittedCommit: CommitData = {
                    commitHash: 'uncommitted',
                    author: 'You',
                    commitMessage: 'Uncommitted Changes',
                    date: new Date(), // Current date and time
                    panelChats: gitHistory.uncommitted.panelChats // Updated to use panelChats
                };
                this._commits.unshift(uncommittedCommit); // Add to the beginning for visibility
            }
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error loading git history: ${error.message}`);
        this._commits = [];
    }
  }

  /**
   * Updates the webview content by loading commits and integrating uncommitted changes.
   */
  public async updateContent(additionalFilePath?: string) {
      await this.loadCommitsAndChats(additionalFilePath);
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
                  console.log('Webview is ready.');
                  this.updateContent();
                  break;
              case 'deleteMessage':
                  console.log('Delete message command received.');
                  this.handleDeleteMessage(message.id);
                  break;
              case 'refresh':
                  console.log('Refresh command received.');
                  this.updateContent();
                  break;
              case 'switchView':
                  console.log('Switch view command received:', message.view);
                  this.handleSwitchView(message.view);
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
   * Handles switching between default and filtered views based on user selection.
   * @param view - The selected view type.
   */
  private async handleSwitchView(view: string) {
      if (view === 'filtered') {
          // Get the currently active editor's file
          const activeEditor = vscode.window.activeTextEditor;
          if (!activeEditor) {
              vscode.window.showErrorMessage('No active editor found to determine the target file.');
              return;
          }

          const targetFileUri = activeEditor.document.uri;
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetFileUri);
          if (!workspaceFolder) {
              vscode.window.showErrorMessage('Active file is not within a workspace folder.');
              return;
          }

          const repoPath = workspaceFolder.uri.fsPath;
          const filePath = path.relative(repoPath, targetFileUri.fsPath);

          this._isFilteredView = true;
          await this.updateContent(filePath);
      } else {
          // Default view
          this._isFilteredView = false;
          await this.updateContent();
      }
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
          // Read the current file content as StashedState
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          let stashedState: StashedState;

          try {
              stashedState = JSON.parse(fileContent);
              if (!isStashedState(stashedState)) {
                  throw new Error('Parsed content does not match StashedState structure.');
              }
          } catch (parseError) {
              vscode.window.showErrorMessage(`Failed to parse stashedPanelChats.json: ${(parseError as Error).message}`);
              console.error(`Error parsing stashedPanelChats.json:`, parseError);
              return;
          }

          let messageFound = false;
          // Iterate through panelChats to find and remove the message
          for (const panelChat of stashedState.panelChats) {
              const messageIndex = panelChat.messages.findIndex(msg => msg.id === messageId);
              if (messageIndex !== -1) {
                  panelChat.messages.splice(messageIndex, 1);
                  messageFound = true;
                  console.log(`Deleted message with ID: ${messageId} from PanelChat ${panelChat.id}`);

                  // Optional: Update lastAppended if necessary
                  // For simplicity, assuming deletion does not affect lastAppended
                  break; // Exit the loop once the message is found and deleted
              }
          }

          if (!messageFound) {
              vscode.window.showErrorMessage(`Message with ID ${messageId} not found.`);
              return;
          }

          // Write the updated stashedState back to the file
          fs.writeFileSync(filePath, JSON.stringify(stashedState, null, 2), 'utf-8');
          console.log(`Updated ${filePath} after deletion.`);

          // Commit the change to Git
          // const git: SimpleGit = simpleGit(repoPath);
          // await git.add(filePath);
          // await git.commit(`Delete message with ID ${messageId}`);
          // console.log(`Committed deletion of message ID ${messageId} to Git.`);

          vscode.window.showInformationMessage(`Message with ID ${messageId} has been deleted.`);

          // Refresh the webview content
          this.updateContent();
      } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to delete message: ${error.message}`);
          console.error(`Error deleting message: ${error.stack}`);
      }
  }

  /**
   * Generates the HTML content for the webview, including a dropdown for view selection.
   * @param webview - The Webview instance.
   * @returns A string containing the HTML.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Commit History</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 0;
            margin: 0;
            overflow: auto;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background-color: var(--vscode-titleBar-activeBackground);
            color: var(--vscode-titleBar-activeForeground);
            padding: 15px;
            border-radius: 5px 5px 0 0;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header h2 {
            margin: 0;
            font-size: 1.5em;
        }
        .commit {
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 15px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
        }
        .commit-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }
        .commit-header:hover {
            background-color: var(--vscode-editor-selectionBackground);
        }
        .commit-header h3 {
            margin: 0;
            font-size: 1.2em;
        }
        .commit-details {
            display: none;
            margin-top: 10px;
        }
        .panel-chat {
            margin-bottom: 15px;
            padding: 10px;
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 5px;
            background-color: var(--vscode-editor-background);
        }
        .panel-chat-header {
            font-weight: bold;
            margin-bottom: 5px;
        }
        .panel-chat-info {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 10px;
        }
        .message-container {
            margin-bottom: 15px;
            position: relative;
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 5px;
            padding: 10px;
            background-color: var(--vscode-editor-background);
        }
        .delete-button {
            position: absolute;
            top: 10px;
            right: 10px;
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
            word-wrap: break-word;
        }
        .response {
            background-color: var(--vscode-editorWidget-background);
            word-wrap: break-word;
        }
        .code-block {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
            overflow-x: auto;
        }
        .no-commits, .no-messages {
            text-align: center;
            color: var(--vscode-editorError-foreground);
            font-style: italic;
            margin-top: 20px;
        }

        /* Dropdown Styles */
        .dropdown-container {
            margin-bottom: 20px;
            display: flex;
            justify-content: flex-end;
            align-items: center;
        }

        .dropdown-container label {
            margin-right: 10px;
            font-weight: bold;
        }

        .dropdown-container select {
            padding: 5px;
            border-radius: 4px;
            border: 1px solid var(--vscode-editorWidget-border);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
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
    <div class="container">
        <div class="header">
            <h2>Git Commit History</h2>
            <button id="refreshButton" title="Refresh Commit History">🔄</button>
        </div>

        <!-- Dropdown for selecting view -->
        <div class="dropdown-container">
            <label for="viewSelect">View:</label>
            <select id="viewSelect">
                <option value="default">All Commits</option>
                <option value="filtered">Commits Touching Specific File</option>
            </select>
        </div>

        <div id="content">
            <div class="no-commits">Loading commit history...</div>
        </div>
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

        /**
         * Escapes HTML characters to prevent XSS attacks.
         * @param {string} text - The text to escape.
         * @returns {string} - The escaped text.
         */
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

        /**
         * Formats the response text, converting code blocks into styled divs.
         * @param {string} responseText - The response text to format.
         * @returns {string} - The formatted HTML string.
         */
        function formatResponse(responseText) {
            if (typeof responseText !== 'string') {
                console.warn('formatResponse received non-string responseText:', responseText);
                return '<em>Invalid response text.</em>';
            }

            const codeBlockRegex = /\`\`\`([^\`]+)\`\`\`/g;
            let formattedText = '';
            let lastIndex = 0;
            let match;

            while ((match = codeBlockRegex.exec(responseText)) !== null) {
                const index = match.index;
                formattedText += escapeHtml(responseText.slice(lastIndex, index));
                formattedText += \`<div class="code-block">\${escapeHtml(match[1].trim())}</div>\`;
                lastIndex = index + match[0].length;
            }

            formattedText += escapeHtml(responseText.slice(lastIndex));
            return formattedText;
        }

        /**
         * Attaches click listeners to commit headers to toggle visibility of commit details.
         */
        function attachCommitToggleListeners() {
            const commitHeaders = document.querySelectorAll('.commit-header');
            commitHeaders.forEach(header => {
                header.addEventListener('click', () => {
                    const details = header.nextElementSibling;
                    if (details) {
                        if (details.style.display === 'block') {
                            details.style.display = 'none';
                        } else {
                            details.style.display = 'block';
                        }
                    }
                });
            });
        }

        /**
         * Attaches click listeners to delete buttons to initiate message deletion.
         */
        function attachDeleteButtonListeners() {
            const deleteButtons = document.querySelectorAll('.delete-button');
            deleteButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation(); // Prevent triggering the commit toggle
                    const messageId = button.getAttribute('data-id');
                    if (messageId) {
                        showConfirmationModal(messageId);
                    } else {
                        console.warn('Delete button clicked without a valid message ID.');
                    }
                });
            });
        }

        /**
         * Displays a custom confirmation modal before deleting a message.
         * @param {string} messageId - The ID of the message to delete.
         */
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

        /**
         * Closes the modal when clicking outside of the modal content.
         * @param {MouseEvent} event - The mouse event.
         */
        window.onclick = function(event) {
            const modal = document.getElementById('confirmModal');
            if (event.target == modal) {
                modal.style.display = 'none';
            }
        };

        /**
         * Attaches an event listener to the refresh button to update commit history.
         */
        document.getElementById('refreshButton').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });

        /**
         * Attaches an event listener to the view dropdown to switch views.
         */
        document.getElementById('viewSelect').addEventListener('change', (event) => {
            const select = event.target;
            const selectedView = select.value;
            vscode.postMessage({ command: 'switchView', view: selectedView });
        });

        /**
         * Handles incoming messages from the extension backend.
         */
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                const contentElement = document.getElementById('content');
                contentElement.innerHTML = ''; // Clear existing content

                if (message.commits && message.commits.length > 0) {
                    message.commits.forEach(commit => {
                        // Create commit container
                        const commitDiv = document.createElement('div');
                        commitDiv.className = 'commit';

                        // Create commit header
                        const commitHeader = document.createElement('div');
                        commitHeader.className = 'commit-header';
                        commitHeader.innerHTML = \`
                            <h3>\${escapeHtml(commit.commitMessage)}</h3>
                            <span style="color: var(--vscode-descriptionForeground); font-size: 0.9em;">\${new Date(commit.date).toLocaleString()}</span>
                        \`;
                        commitDiv.appendChild(commitHeader);

                        // Create commit details container
                        const commitDetails = document.createElement('div');
                        commitDetails.className = 'commit-details';

                        // Populate panelChats
                        if (commit.panelChats && commit.panelChats.length > 0) {
                            commit.panelChats.forEach(panelChat => {
                                // Create panelChat container
                                const panelChatDiv = document.createElement('div');
                                panelChatDiv.className = 'panel-chat';

                                // PanelChat header
                                const panelChatHeader = document.createElement('div');
                                panelChatHeader.className = 'panel-chat-header';
                                panelChatHeader.textContent = \`PanelChat ID: \${escapeHtml(panelChat.id)}\`;
                                panelChatDiv.appendChild(panelChatHeader);

                                // PanelChat info (customTitle, ai_editor, etc.)
                                const panelChatInfo = document.createElement('div');
                                panelChatInfo.className = 'panel-chat-info';
                                panelChatInfo.innerHTML = \`
                                    <strong>Title:</strong> \${escapeHtml(panelChat.customTitle)}<br>
                                    <strong>AI Editor:</strong> \${escapeHtml(panelChat.ai_editor)}<br>
                                    <strong>Created On:</strong> \${new Date(panelChat.created_on).toLocaleString()}<br>
                                    <strong>Parent ID:</strong> \${panelChat.parent_id ? escapeHtml(panelChat.parent_id) : 'N/A'}
                                \`;
                                panelChatDiv.appendChild(panelChatInfo);

                                // Messages in panelChat
                                panelChat.messages.forEach(messageEntry => {
                                    const messageContainer = document.createElement('div');
                                    messageContainer.className = 'message-container';

                                    // Delete button
                                    const deleteBtn = document.createElement('button');
                                    deleteBtn.className = 'delete-button';
                                    deleteBtn.setAttribute('data-id', messageEntry.id);
                                    deleteBtn.title = 'Delete Message';
                                    deleteBtn.textContent = '×';
                                    messageContainer.appendChild(deleteBtn);

                                    // Message Text
                                    const messageDiv = document.createElement('div');
                                    messageDiv.className = 'message';
                                    messageDiv.innerHTML = escapeHtml(messageEntry.messageText);
                                    messageContainer.appendChild(messageDiv);

                                    // Response Text
                                    const responseDiv = document.createElement('div');
                                    responseDiv.className = 'response';
                                    responseDiv.innerHTML = formatResponse(messageEntry.responseText);
                                    messageContainer.appendChild(responseDiv);

                                    // Additional Message Details
                                    const messageDetails = document.createElement('div');
                                    messageDetails.className = 'message-details';
                                    messageDetails.style.fontSize = '0.8em';
                                    messageDetails.style.color = 'var(--vscode-descriptionForeground)';
                                    messageDetails.innerHTML = \`
                                        <strong>Model:</strong> \${escapeHtml(messageEntry.model)}<br>
                                        <strong>Timestamp:</strong> \${new Date(messageEntry.timestamp).toLocaleString()}
                                    \`;
                                    messageContainer.appendChild(messageDetails);

                                    // Optionally, display context if needed
                                    if (messageEntry.context && messageEntry.context.length > 0) {
                                        const contextDiv = document.createElement('div');
                                        contextDiv.className = 'context';
                                        contextDiv.style.fontSize = '0.8em';
                                        contextDiv.style.color = 'var(--vscode-descriptionForeground)';
                                        contextDiv.innerHTML = \`<strong>Context:</strong> \${escapeHtml(JSON.stringify(messageEntry.context))}\`;
                                        messageContainer.appendChild(contextDiv);
                                    }

                                    panelChatDiv.appendChild(messageContainer);
                                });

                                commitDetails.appendChild(panelChatDiv);
                            });
                        } else {
                            const noPanelChats = document.createElement('div');
                            noPanelChats.className = 'no-messages';
                            noPanelChats.textContent = 'No panelChats in this commit.';
                            commitDetails.appendChild(noPanelChats);
                        }

                        commitDiv.appendChild(commitDetails);
                        contentElement.appendChild(commitDiv);
                    });

                    // Attach event listeners for collapsible commits
                    attachCommitToggleListeners();

                    // Attach event listeners for delete buttons
                    attachDeleteButtonListeners();
                } else {
                    const noCommits = document.createElement('div');
                    noCommits.className = 'no-commits';
                    noCommits.textContent = 'No commits found.';
                    contentElement.appendChild(noCommits);
                }
            }
        });

        /**
         * Notifies the extension that the Webview is ready.
         */
        // Notify the extension that the Webview is ready
        vscode.postMessage({ command: 'webviewReady' });
        console.log('Webview is ready.');
    </script>
</body>
</html>
    `;
}


}

/**
 * Generates a random nonce for Content Security Policy.
 * @returns {string} - A random 32-character string.
 */
function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
