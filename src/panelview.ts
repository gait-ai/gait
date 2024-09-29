import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { CommitData, UncommittedData, GitHistoryData, getGitHistory, getGitHistoryThatTouchesFile } from './panelgit';
import { readStashedState, writeStashedState, writeStashedStateToFile } from './stashedState';
import { panelChatsToMarkdown } from './markdown'; // Added import
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
        let context = this._context;

        const repoPath = workspaceFolder.uri.fsPath;
        const filePath = '.gait/stashedPanelChats.json.gz'; // Replace with your actual file path relative to repo

        try {
            if (this._isFilteredView && additionalFilePath) {
                const gitHistory: GitHistoryData = await getGitHistoryThatTouchesFile(this._context, repoPath, filePath, additionalFilePath);

                // Map CommitData from getGitHistoryThatTouchesFile to the class's commit structure
                this._commits = gitHistory.commits.map(commit => ({
                    commitHash: commit.commitHash,
                    commitMessage: commit.commitMessage,
                    author: commit.author,
                    date: new Date(commit.date),
                    panelChats: commit.panelChats,
                    inlineChats: commit.inlineChats
                })).sort((a, b) => b.date.getTime() - a.date.getTime());

                // Handle uncommitted changes by appending them to the commits array
                if (gitHistory.uncommitted) {
                    const uncommittedCommit: CommitData = {
                        commitHash: 'uncommitted',
                        author: 'You',
                        commitMessage: 'Uncommitted Changes',
                        date: new Date(), // Current date and time
                        panelChats: gitHistory.uncommitted.panelChats, // Updated to use panelChats
                        inlineChats: gitHistory.uncommitted.inlineChats
                    };
                    this._commits.unshift(uncommittedCommit); // Add to the beginning for visibility
                }
            } else {
                const gitHistory: GitHistoryData = await getGitHistory(this._context, repoPath, filePath);

                // Map CommitData from getGitHistory to the class's commit structure
                this._commits = gitHistory.commits.map(commit => ({
                    commitHash: commit.commitHash,
                    commitMessage: commit.commitMessage,
                    author: commit.author,
                    date: new Date(commit.date),
                    panelChats: commit.panelChats,
                    inlineChats: commit.inlineChats
                })).sort((a, b) => b.date.getTime() - a.date.getTime());

                // Handle uncommitted changes by appending them to the commits array
                if (gitHistory.uncommitted) {
                    const uncommittedCommit: CommitData = {
                        commitHash: 'uncommitted',
                        author: 'You',
                        commitMessage: 'Added Chats',
                        date: new Date(), // Current date and time
                        panelChats: gitHistory.uncommitted.panelChats,
                        inlineChats: gitHistory.uncommitted.inlineChats
                    };
                    this._commits.unshift(uncommittedCommit); // Add to the beginning for visibility
                }
                const currentPanelChats = context.workspaceState.get('currentPanelChats');
                if (currentPanelChats && Array.isArray(currentPanelChats)) {
                    let filteredCurrentPanelChats = currentPanelChats;
                    if (gitHistory.uncommitted) {
                        // Filter out panelChats from currentPanelChats that are already in uncommitted
                        const uncommittedPanelChatIds = new Set(gitHistory.uncommitted.panelChats.map(pc => pc.id));
                        filteredCurrentPanelChats = currentPanelChats.filter((pc: { id: string }) => !uncommittedPanelChatIds.has(pc.id));
                    }
                    // If there are any remaining filtered panelChats, add them to the uncommitted commit
                    if (filteredCurrentPanelChats.length > 0) {
                        const unaddedCommit: CommitData = {
                            commitHash: 'unadded',
                            author: 'You',
                            commitMessage: 'Unadded Chats',
                            date: new Date(), // Current date and time
                            panelChats: filteredCurrentPanelChats, // Updated to use panelChats
                            inlineChats: []
                        };
                        this._commits.unshift(unaddedCommit); // Add to the beginning for visibility
                    }
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

    private async handleDeletePanelChat(panelChatId: string) {
        const stashedState = readStashedState(this._context);
        stashedState.deletedChats.deletedPanelChatIDs.push(panelChatId);
        writeStashedState(this._context, stashedState);
        writeStashedStateToFile(stashedState);
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
                    this.updateContent();
                    break;
                case 'deleteMessage':
                    this.handleDeleteMessage(message.id);
                    break;
                case 'deletePanelChat':
                    this.handleDeletePanelChat(message.id);
                    break;
                case 'refresh':
                    if (this._isFilteredView) {
                        const editor = vscode.window.activeTextEditor;
                        if (editor) {
                            const document = editor.document;
                            const filePath = vscode.workspace.asRelativePath(document.uri.fsPath);
                            this.updateContent(filePath);
                        }
                    } else {
                        this.updateContent();
                    }
                    break;
                case 'switchView':
                    this.handleSwitchView(message.view);
                    break;
                case 'appendContext': // New case for appending context
                    this.handleAppendContext(message.commitHash, message.panelChatId);
                    break;
                default:
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
            this._isFilteredView = true;
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const filePath = vscode.workspace.asRelativePath(document.uri.fsPath);
                await this.updateContent(filePath);
            }
            //await this.updateContent();
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
        const stashedState = readStashedState(this._context);
        stashedState.deletedChats.deletedMessageIDs.push(messageId);
        writeStashedState(this._context, stashedState);
        writeStashedStateToFile(stashedState);
    }

    /**
     * Handles appending panelChat messages to gaitContext.md
     * @param commitHash - The hash of the commit containing the panelChat.
     * @param panelChatId - The ID of the panelChat to append.
     */
    private async handleAppendContext(commitHash: string, panelChatId: string) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        const repoPath = workspaceFolder.uri.fsPath;
        const filePath = path.join(repoPath, 'gaitContext.md'); // Path to gaitContext.md

        try {
            // Ensure the file exists; if not, create it with a header
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, '# Gait Context\n\n', 'utf-8');
            }

            // Find the specific commit
            const targetCommit = this._commits.find(commit => commit.commitHash === commitHash);
            if (!targetCommit) {
                vscode.window.showErrorMessage(`Commit with hash ${commitHash} not found.`);
                return;
            }

            // Find the specific panelChat within the commit
            const targetPanelChat = targetCommit.panelChats.find(pc => pc.id === panelChatId);
            if (!targetPanelChat) {
                vscode.window.showErrorMessage(`PanelChat with ID ${panelChatId} not found in commit ${commitHash}.`);
                return;
            }

            // Convert the panelChat to Markdown
            const markdownContent = panelChatsToMarkdown([{ commit: targetCommit, panelChat: targetPanelChat }]);

            // Append the markdown content to gaitContext.md
            fs.appendFileSync(filePath, markdownContent + '\n\n', 'utf-8');

            vscode.window.showInformationMessage(`PanelChat with ID ${panelChatId} from commit ${commitHash} has been appended to gaitContext.md.`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to append context: ${error.message}`);
            console.error(`Error appending context: ${error.stack}`);
        }
    }

    /**
     * Generates the HTML content for the webview, including a dropdown for view selection.
     * @param webview - The Webview instance.
     * @returns A string containing the HTML.
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();
        const prismCssPath = vscode.Uri.joinPath(this._context.extensionUri, 'media', 'prism.css');
        const prismJsPath = vscode.Uri.joinPath(this._context.extensionUri, 'media', 'prism.js');
        const markedJsPath = vscode.Uri.joinPath(this._context.extensionUri, 'media', 'marked.js'); // Path to Marked.js
        const prismCssUri = webview.asWebviewUri(prismCssPath);
        const prismJsUri = webview.asWebviewUri(prismJsPath);
        const markedJsUri = webview.asWebviewUri(markedJsPath); // URI for Marked.js

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Commit History</title>
    
 <!-- Content Security Policy -->
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src 'nonce-${nonce}' ${webview.cspSource};
        script-src 'nonce-${nonce}' ${webview.cspSource};
        connect-src 'self';
        img-src 'self';
        font-src 'self';
    ">
    
    <!-- Prism.js CSS -->
    <link href="${prismCssUri}" rel="stylesheet" />
    <!-- Marked.js -->
    <script src="${markedJsUri}" nonce="${nonce}"></script>

    <style nonce="${nonce}">
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
        .commit-date {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
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
            display: flex;
            align-items: center;
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
        .delete-panelchat-button {
            background: transparent;
            border: none;
            color: red;
            font-weight: bold;
            cursor: pointer;
            margin-left: 10px;
            font-size: 16px;
        }
        .delete-panelchat-button:hover {
            color: darkred;
        }
        .append-context-button {
            background: transparent;
            border: none;
            color: blue;
            font-weight: bold;
            cursor: pointer;
            margin-left: 10px;
            font-size: 16px;
        }
        .append-context-button:hover {
            color: darkblue;
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
        pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            overflow-x: auto;
        }
        code {
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
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

        .hidden {
            display: none;
        }

        .visible {
            display: flex; /* or block, depending on your layout needs */
        }


        /* Override Prism.js styles if necessary */
        /* Example: Adjusting code block background */
        pre[class*="language-"] {
            background: var(--vscode-textCodeBlock-background) !important;
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
    <div id="confirmModal" class="modal hidden">
        <div class="modal-content">
            <p>Are you sure you want to delete this item?</p>
            <div class="modal-buttons">
                <button id="confirmYes">Yes</button>
                <button id="confirmNo">No</button>
            </div>
        </div>
    </div>

    <!-- Prism.js JS -->
    <script src="${prismJsUri}" nonce="${nonce}"> </script>

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

        function formatResponse(responseText) {
            if (typeof responseText !== 'string') {
                console.warn('formatResponse received non-string responseText:', responseText);
                return '<em>Invalid response text.</em>';
            }

            // Enhanced regex to handle optional newline after language specifier
            const codeBlockRegex = /\`\`\`(\\w+)?\\n?([\\s\\S]+?)\`\`\`/g;
            let formattedText = '';
            let lastIndex = 0;
            let match;
            let matchFound = false;

            console.warn('Response text:', responseText); // Debugging log

            while ((match = codeBlockRegex.exec(responseText)) !== null) {
                matchFound = true;
                const index = match.index;
                console.warn('Matched code block:', match[0]); // Debugging log

                // Escape and append text before the code block
                formattedText += escapeHtml(responseText.slice(lastIndex, index));

                const language = match[1] ? match[1].trim().replace(/\\n+$/, '') : '';
                const code = match[2] ? escapeHtml(match[2].trim()) : '';

                console.warn('Language', JSON.stringify(language));// Debugging log
                console.warn('Code', JSON.stringify(code)); // Debugging log

                // Append the formatted code block
                formattedText += \`<pre><code class="language-\${language}">\${code}</code></pre>\`;

                lastIndex = index + match[0].length;
            }

            if (!matchFound) {
                console.warn('No code blocks found in responseText.');
            }

            // Escape and append the remaining text after the last code block
            formattedText += marked.parse(escapeHtml(responseText.slice(lastIndex)));
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
                            const codeBlocks = details.querySelectorAll('pre code');
                            console.log('Found code blocks:', codeBlocks);
                            codeBlocks.forEach((block) => {
                                Prism.highlightElement(block);
                            });
                        }
                    }
                });
            });
        }

        /**
         * Attaches click listeners to delete buttons to initiate message or panel chat deletion.
         */
        function attachDeleteButtonListeners() {
            // Existing Delete Message Buttons
            const deleteMessageButtons = document.querySelectorAll('.delete-button');
            deleteMessageButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation(); // Prevent triggering the commit toggle
                    const messageId = button.getAttribute('data-id');
                    if (messageId) {
                        showConfirmationModal('message', messageId);
                    } else {
                        console.warn('Delete button clicked without a valid message ID.');
                    }
                });
            });

            // Existing Delete PanelChat Buttons
            const deletePanelChatButtons = document.querySelectorAll('.delete-panelchat-button');
            deletePanelChatButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation(); // Prevent triggering the commit toggle
                    const panelChatId = button.getAttribute('data-id');
                    if (panelChatId) {
                        showConfirmationModal('panelChat', panelChatId);
                    } else {
                        console.warn('Delete PanelChat button clicked without a valid PanelChat ID.');
                    }
                });
            });

            // New Append to gaitContext.md Buttons
            const appendContextButtons = document.querySelectorAll('.append-context-button');
            appendContextButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation(); // Prevent triggering the commit toggle
                    const commitHash = button.getAttribute('data-commit');
                    const panelChatId = button.getAttribute('data-id');
                    if (commitHash && panelChatId) {
                        vscode.postMessage({ 
                            command: 'appendContext', 
                            commitHash: commitHash, 
                            panelChatId: panelChatId 
                        });
                    } else {
                        console.warn('Append Context button clicked without valid commitHash or PanelChat ID.');
                    }
                });
            });
        }

        /**
         * Displays a custom confirmation modal before deleting a message or panel chat.
         * @param {string} type - The type of deletion ('message' or 'panelChat').
         * @param {string} id - The ID of the item to delete.
         */
        function showConfirmationModal(type, id) {
            const modal = document.getElementById('confirmModal');
            const modalMessage = modal.querySelector('p');
            modalMessage.textContent = type === 'message' 
                ? 'Are you sure you want to delete this message?' 
                : 'Are you sure you want to delete this PanelChat?';

            // Remove 'hidden' and add 'visible' to show the modal
            modal.classList.remove('hidden');
            modal.classList.add('visible');

            // Handle "Yes" button click
            document.getElementById('confirmYes').onclick = function() {
                if (type === 'message') {
                    //console.log('Sending deleteMessage command for ID: ' + id);
                    vscode.postMessage({ command: 'deleteMessage', id: id });
                } else if (type === 'panelChat') {
                    //console.log('Sending deletePanelChat command for ID: ' + id);
                    vscode.postMessage({ command: 'deletePanelChat', id: id });
                }
                // Hide the modal after action
                modal.classList.remove('visible');
                modal.classList.add('hidden');
            };

            // Handle "No" button click
            document.getElementById('confirmNo').onclick = function() {
                console.log('Deletion cancelled by user.');
                // Hide the modal
                modal.classList.remove('visible');
                modal.classList.add('hidden');
            };
        }

        // Close the modal when clicking outside of the modal content
        window.onclick = function(event) {
            const modal = document.getElementById('confirmModal');
            if (event.target == modal) {
                modal.classList.remove('visible');
                modal.classList.add('hidden');
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
                            <span class="commit-date">\${new Date(commit.date).toLocaleString()}</span>
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

                                // PanelChat header with delete and append buttons
                                const panelChatHeader = document.createElement('div');
                                panelChatHeader.className = 'panel-chat-header';
                                panelChatHeader.innerHTML = \`
                                    PanelChat ID: \${escapeHtml(panelChat.id)}
                                    <button class="delete-panelchat-button" data-id="\${escapeHtml(panelChat.id)}" title="Delete PanelChat">🗑️</button>
                                    <button 
                                        class="append-context-button" 
                                        data-commit="\${escapeHtml(commit.commitHash)}" 
                                        data-id="\${escapeHtml(panelChat.id)}" 
                                        title="Append to gaitContext.md"
                                    >
                                        📄
                                    </button>
                                \`;
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

                    // Attach event listeners for delete and append buttons
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
        //console.log('Webview is ready.');
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