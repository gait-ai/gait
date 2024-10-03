import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { CommitData, GitHistoryData, getGitHistory, getGitHistoryThatTouchesFile } from './panelgit';
import { PanelChat } from './types';
import { readStashedState, writeStashedState, removeMessageFromStashedState, removePanelChatFromStashedState, writeChatToStashedState } from './stashedState';
import { panelChatsToMarkdown } from './markdown'; // Added import
import { STASHED_GAIT_STATE_FILE_NAME } from './constants';
import posthog from 'posthog-js';
import { identifyUser } from './identify_user';
import { InlineChatInfo, removeInlineChat } from './inline'; 

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
            //vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }
        let context = this._context;

        const repoPath = workspaceFolder.uri.fsPath;
        const filePath = `.gait/${STASHED_GAIT_STATE_FILE_NAME}`; // Replace with your actual file path relative to repo

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

                if (gitHistory.added) {
                    const uncommittedCommit: CommitData = {
                        commitHash: 'added',
                        author: 'You',
                        commitMessage: 'Added Changes',
                        date: new Date(), // Current date and time
                        panelChats: gitHistory.added.panelChats, // Updated to use panelChats
                        inlineChats: gitHistory.added.inlineChats
                    };
                    this._commits.unshift(uncommittedCommit); // Add to the beginning for visibility
                }
                else{
                    console.log("No added changes");
                }

                // Handle uncommitted changes by appending them to the commits array
                if (gitHistory.uncommitted) {
                    const uncommittedCommit: CommitData = {
                        commitHash: 'uncommitted',
                        author: 'You',
                        commitMessage: 'Unadded Changes',
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

                if (gitHistory.added) {
                    const uncommittedCommit: CommitData = {
                        commitHash: 'added',
                        author: 'You',
                        commitMessage: 'Added Changes',
                        date: new Date(), // Current date and time
                        panelChats: gitHistory.added.panelChats, // Updated to use panelChats
                        inlineChats: gitHistory.added.inlineChats
                    };
                    this._commits.unshift(uncommittedCommit); // Add to the beginning for visibility
                }

                // Handle uncommitted changes by appending them to the commits array
                if (gitHistory.uncommitted) {
                    const uncommittedCommit: CommitData = {
                        commitHash: 'uncommitted',
                        author: 'You',
                        commitMessage: 'Unadded Changes',
                        date: new Date(), // Current date and time
                        panelChats: gitHistory.uncommitted.panelChats,
                        inlineChats: gitHistory.uncommitted.inlineChats
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
    public async updateContent() {

        if (this._isFilteredView) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const filePath = vscode.workspace.asRelativePath(document.uri.fsPath);
                await this.loadCommitsAndChats(filePath);
            }
        } else {
            await this.loadCommitsAndChats();
        }
        if (this._view) {
            this._view.webview.postMessage({
                type: 'update',
                commits: this._commits,
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
    }

    private async handleRemovePanelChatFromStashedState(panelChatId: string) {
        console.log(`Removing panelChat with ID ${panelChatId} from stashed state.`);
        removePanelChatFromStashedState(this._context, panelChatId);
    }

    private async handleRemoveMessageFromStashedState(messageId: string) {
        console.log(`Removing message with ID ${messageId} from stashed state.`);
        removeMessageFromStashedState(this._context, messageId);
    }
    
    private async handleDeleteInlineChat(inlineChatId: string) {
        console.log(`Removing inlineChat with ID ${inlineChatId} from stashed state.`);
        removeInlineChat(this._context, inlineChatId);
    }

    private async handleWriteChatToStashedState(panelChatId?: string, messageId?: string) {
        if ((panelChatId && messageId) || (!panelChatId && !messageId)) {
            vscode.window.showErrorMessage('Invalid parameters: Provide either panelChatId or messageId, but not both.');
            if (panelChatId && messageId) {
                vscode.window.showErrorMessage('Both panelChatId and messageId provided. Please provide only one.');
            }
            else {
                vscode.window.showErrorMessage('No panelChatId or messageId provided. Please provide one.');
            }
            return;
        }

        try {
            if (panelChatId) {
                // Find the PanelChat with the given panelChatId
                    const panelChat = this._commits[0].panelChats.find(pc => pc.id === panelChatId);
                    if (panelChat) {
                        // Write the entire PanelChat to stashed state
                        await writeChatToStashedState(this._context, panelChat);
                        vscode.window.showInformationMessage(`PanelChat with ID ${panelChatId} has been stashed.`);
                        return;
                    }
                
                vscode.window.showErrorMessage(`PanelChat with ID ${panelChatId} not found.`);
            } else if (messageId) {
                // Find the MessageEntry with the given messageId
                    for (const panelChat of this._commits[0].panelChats) {
                        const message = panelChat.messages.find(msg => msg.id === messageId);
                        if (message) {
                            // Construct a new PanelChat containing only this message
                            const newPanelChat: PanelChat = {
                                ai_editor: panelChat.ai_editor,
                                id: panelChat.id,
                                customTitle: `Stashed Message ${message.id}`,
                                parent_id: null,
                                created_on: new Date().toISOString(),
                                messages: [message],
                                kv_store: {}
                            };
                            // Write the new PanelChat to stashed state
                            await writeChatToStashedState(this._context, newPanelChat);
                            vscode.window.showInformationMessage(`Message with ID ${messageId} has been stashed.`);
                            return;
                        }
                    
                }
                vscode.window.showErrorMessage(`Message with ID ${messageId} not found.`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to write chat to stashed state: ${error.message}`);
            console.error(`Error in handleWriteChatToStashedState: ${error.stack}`);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        identifyUser();
        posthog.capture('$pageview');
        this._view = webviewView;
        // Add analytics for the number of inlineChats and panelChats saved
        const stashedState = readStashedState(this._context);
        const panelChatsCount = stashedState.panelChats.length;
        const inlineChatsCount = stashedState.inlineChats.length;
        
        posthog.capture('panel_view_opened', {
            panelChatsCount: panelChatsCount,
            inlineChatsCount: inlineChatsCount,
            repo: this._context.workspaceState.get('repoid')
        });

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
                    posthog.capture('delete_message');
                    this.handleDeleteMessage(message.id);
                    this.updateContent();
                    break;
                case 'deletePanelChat':
                    posthog.capture('delete_panelchat');
                    this.handleDeletePanelChat(message.id);
                    this.updateContent();
                    break;
                case 'refresh':
                    this.updateContent();
                    break;
                case 'switchView':
                    this.handleSwitchView(message.view);
                    break;
                case 'appendContext': // New case for appending context
                    this.handleAppendContext(message.commitHash, message.panelChatId);
                    break;
                case 'writeChatToStashedState': // New case for writing chat to stashed state
                    this.handleWriteChatToStashedState(message.panelChatId, message.messageId);
                    posthog.capture('manual_stage');
                    this.updateContent();
                    break;                
                case 'removePanelChatFromStashedState': // New case for removing panelChat from stashed state
                    this.handleRemovePanelChatFromStashedState(message.panelChatId);
                    posthog.capture('manual_unstage');
                    this.updateContent();
                    break;
                case 'removeMessageFromStashedState': // New case for removing message from stashed state
                    this.handleRemoveMessageFromStashedState(message.messageId);
                    this.updateContent();
                    break;
                case 'deleteInlineChat':
                    this.handleDeleteInlineChat(message.id);
                    this.updateContent();
                    break;
                case 'openFile':
                    this.handleOpenFile(message.path);
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
            //await this.updateContent();
        } else {
            // Default view
            this._isFilteredView = false;
        }
        await this.updateContent();
    }

    /**
     * Handles the deletion of a message by its ID.
     * @param messageId - The ID of the message to delete.
     */
    private async handleDeleteMessage(messageId: string) {
        const stashedState = readStashedState(this._context);
        stashedState.deletedChats.deletedMessageIDs.push(messageId);
        writeStashedState(this._context, stashedState);
    }

    /**
     * Handles appending panelChat messages to gaitContext.md
     * @param commitHash - The hash of the commit containing the panelChat.
     * @param panelChatId - The ID of the panelChat to append.
     */
    private async handleAppendContext(commitHash: string, panelChatId: string) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            //vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        const repoPath = workspaceFolder.uri.fsPath;
        const filePath = path.join(repoPath, 'gait_context.md');

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
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), { viewColumn: vscode.ViewColumn.Beside });
            await vscode.commands.executeCommand('aichat.newchataction');

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to append context: ${error.message}`);
            console.error(`Error appending context: ${error.stack}`);
        }
    }

    /**
     * Handles opening a file in the editor.
     * @param filePath - The path of the file to open.
     */
    private async handleOpenFile(filePath: string) {
        console.log(`Opening file: ${filePath}`);
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found.');
                return;
            }

            const fullPath = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, filePath));
            const document = await vscode.workspace.openTextDocument(fullPath);
            await vscode.window.showTextDocument(document);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to open file: ${error.message}`);
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
        const workspaceFolderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <script>
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init('phc_vosMtvFFxCN470e8uHGDYCD6YuuSRSoFoZeLuciujry',{api_host:'https://us.i.posthog.com',})
    </script>
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
            cursor: pointer; /* Make it clickable */
        }
        .panel-chat-header:hover {
            background-color: var(--vscode-editor-selectionBackground);
        }
        .panel-chat-info {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 10px;
        }
        .panel-chat-details {
            display: none; /* Hidden by default */
            margin-top: 10px;
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
        .write-chat-button {
            background: transparent;
            border: none;
            color: green;
            font-weight: bold;
            cursor: pointer;
            margin-left: 10px;
            font-size: 16px;
        }
        .write-chat-button:hover {
            color: darkgreen;
        }
        .remove-chat-button {
            background: transparent;
            border: none;
            color: orange;
            font-weight: bold;
            cursor: pointer;
            margin-left: 10px;
            font-size: 16px;
        }
        .remove-chat-button:hover {
            color: darkorange;
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

        /* Inline Chat Styles */
        .inline-chats-container {
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 5px;
            padding: 10px;
            margin-top: 10px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
        }

        .inline-chats-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }

        .inline-chats-header:hover {
            background-color: var(--vscode-editor-selectionBackground);
        }

        .inline-chats-details {
            display: none;
            margin-top: 10px;
        }

        .inline-chat {
            margin-bottom: 10px;
            padding: 10px;
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 5px;
            background-color: var(--vscode-editor-background);
        }

        .inline-chat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }

        .inline-chat-header:hover {
            background-color: var(--vscode-editor-selectionBackground);
        }

        .inline-chat-details {
            display: none;
            margin-top: 10px;
        }

        .inline-chat-prompt {
            margin-bottom: 5px;
        }

        .file-diff {
            margin-left: 20px;
            background-color: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 3px;
            overflow-x: auto;
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

        setInterval(() => {
            vscode.postMessage({ command: 'refresh' });
        }, 3000);

        const vscode = acquireVsCodeApi();
        const workspaceFolderPath = '${workspaceFolderPath}';

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
         * Attaches click listeners to panel chat headers to toggle visibility of panel chat details.
         */
        function attachPanelChatToggleListeners() {
            const panelChatHeaders = document.querySelectorAll('.panel-chat-header');
            panelChatHeaders.forEach(header => {
                header.addEventListener('click', () => {
                    const details = header.nextElementSibling;
                    if (details) {
                        if (details.style.display === 'block') {
                            details.style.display = 'none';
                        } else {
                            details.style.display = 'block';
                            const codeBlocks = details.querySelectorAll('pre code');
                            console.log('Found code blocks in panel chat:', codeBlocks);
                            codeBlocks.forEach((block) => {
                                Prism.highlightElement(block);
                            });
                        }
                    }
                });
            });
        }

        function attachLinkListeners() {
            const contentElement = document.getElementById('content');
            contentElement.addEventListener('click', (event) => {
                const target = event.target;
                if (target && target.matches('a.context-link')) {
                    event.preventDefault();
                    const path = target.dataset.path;
                    if (path) {
                        console.log('Context link clicked:', path);
                        vscode.postMessage({ command: 'openFile', path: path });
                    } else {
                        console.warn('Clicked link does not have a data-path attribute.');
                    }
                }
            });
        }

       /**
         * Attaches click listeners to inline chat headers to toggle visibility of inline chat details.
         */
        function attachInlineChatToggleListeners() {
            const inlineChatsHeaders = document.querySelectorAll('.inline-chats-header');
            inlineChatsHeaders.forEach(header => {
                header.addEventListener('click', () => {
                    const details = header.nextElementSibling;
                    if (details) {
                        if (details.style.display === 'block') {
                            details.style.display = 'none';
                            isInlineChatsExpanded = false;
                        } else {
                            details.style.display = 'block';
                            Prism.highlightAll();
                            isInlineChatsExpanded = true;
                        }
                    }
                });
            });

            const inlineChatHeaders = document.querySelectorAll('.inline-chat-header');
            inlineChatHeaders.forEach(header => {
                header.addEventListener('click', () => {
                    const details = header.nextElementSibling;
                    if (details) {
                        if (details.style.display === 'block') {
                            details.style.display = 'none';
                        } else {
                            details.style.display = 'block';
                            const codeBlocks = details.querySelectorAll('pre code');
                            console.log('Found code blocks in inline chat:', codeBlocks);
                            codeBlocks.forEach((block) => {
                                Prism.highlightElement(block);
                            });
                        }
                    }
                });
            });
        }

        /**
         * Attaches click listeners to delete, write, and remove buttons to handle respective actions.
         */
        function attachButtonListeners() {
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

            // New Write Chat Buttons for Unadded Changes
            const writeChatButtons = document.querySelectorAll('.write-chat-button');
            writeChatButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const panelChatId = button.getAttribute('data-panel-chat-id');
                    const messageId = button.getAttribute('data-message-id');

                    if (panelChatId) {
                        vscode.postMessage({
                            command: 'writeChatToStashedState',
                            panelChatId: panelChatId
                        });
                    } else if (messageId) {
                        vscode.postMessage({
                            command: 'writeChatToStashedState',
                            messageId: messageId
                        });
                    } else {
                        console.warn('Write Chat button clicked without valid data.');
                    }
                });
            });

            // New Remove Chat Buttons for Added Changes
            const removeChatButtons = document.querySelectorAll('.remove-chat-button');
            removeChatButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const panelChatId = button.getAttribute('data-panel-chat-id');
                    const messageId = button.getAttribute('data-message-id');
                    if (panelChatId) {
                        vscode.postMessage({
                            command: 'removePanelChatFromStashedState',
                            panelChatId: panelChatId
                        });
                    } else if (messageId) {
                        vscode.postMessage({
                            command: 'removeMessageFromStashedState',
                            messageId: messageId
                        });
                    } else {
                        console.warn('Remove Chat button clicked without valid data.');
                    }
                });
            });
            // Inline Chat Delete Buttons
            const deleteInlineChatButtons = document.querySelectorAll('.delete-inlinechat-button');
            deleteInlineChatButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation(); // Prevent triggering the inline chat toggle
                    const inlineChatId = button.getAttribute('data-id');
                    if (inlineChatId) {
                        showConfirmationModal('inlineChat', inlineChatId);
                    } else {
                        console.warn('Delete InlineChat button clicked without a valid InlineChat ID.');
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
                } else if (type === 'inlineChat') {
                    vscode.postMessage({ command: 'deleteInlineChat', id: id });
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

        let scrollPosition = 0;
        let expandedCommits = new Set();
        let expandedPanelChats = new Set(); // New Set to track expanded panel chats
        let expandedInlineChats = new Set(); // New Set to track expanded inline chats
        let isInlineChatsExpanded = false; // New flag to track the expanded state of inline chats


        function saveScrollPosition() {
            scrollPosition = document.scrollingElement.scrollTop;
        }

        function restoreScrollPosition() {
            document.scrollingElement.scrollTop = scrollPosition;
        }

        function saveExpandedCommits() {
            expandedCommits.clear();
            document.querySelectorAll('.commit-details').forEach((details, index) => {
                if (details.style.display === 'block') {
                    expandedCommits.add(index);
                }
            });
        }

        function restoreExpandedCommits() {
            document.querySelectorAll('.commit-details').forEach((details, index) => {
                if (expandedCommits.has(index)) {
                    details.style.display = 'block';
                }
            });
        }

        /**
         * Saves the expanded state of panel chats.
         */
        function saveExpandedPanelChats() {
            expandedPanelChats.clear();
            document.querySelectorAll('.panel-chat-details').forEach((details) => {
                const parentHeader = details.previousElementSibling;
                if (details.style.display === 'block' && parentHeader) {
                    const panelChatId = parentHeader.getAttribute('data-panel-chat-id');
                    if (panelChatId) {
                        expandedPanelChats.add(panelChatId);
                    }
                }
            });
        }

        /**
         * Restores the expanded state of panel chats.
         */
        function restoreExpandedPanelChats() {
            document.querySelectorAll('.panel-chat-details').forEach((details) => {
                const parentHeader = details.previousElementSibling;
                if (parentHeader) {
                    const panelChatId = parentHeader.getAttribute('data-panel-chat-id');
                    if (panelChatId && expandedPanelChats.has(panelChatId)) {
                        details.style.display = 'block';
                    }
                }
            });
        }

         function saveExpandedInlineChats() {
            expandedInlineChats.clear();
            document.querySelectorAll('.inline-chat-details').forEach((details, index) => {
                const header = details.previousElementSibling;
                const inlineChatId = header.getAttribute('data-id');
                if (details.style.display === 'block' && inlineChatId) {
                    expandedInlineChats.add(inlineChatId);
                }
            });
        }

        /**
         * Restores the expanded state of inline chats.
         */
        function restoreExpandedInlineChats() {
            document.querySelectorAll('.inline-chat-details').forEach((details) => {
                const header = details.previousElementSibling;
                const inlineChatId = header.getAttribute('data-id');
                if (inlineChatId && expandedInlineChats.has(inlineChatId)) {
                    details.style.display = 'block';
                }
            });
        }


        /**
         * Restores the expansion state of the top-level inline chats container.
         */
        function restoreInlineChatsExpandedState() {
            const inlineChatsDetails = document.querySelector('.inline-chats-details');
            if (inlineChatsDetails) {
                if (isInlineChatsExpanded) {
                    inlineChatsDetails.style.display = 'block';
                } else {
                    inlineChatsDetails.style.display = 'none';
                }
            }
        }

        /**
         * Handles incoming messages from the extension backend.
         */
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                saveScrollPosition();
                saveExpandedCommits();
                saveExpandedPanelChats(); // Save expanded panel chats
                saveExpandedInlineChats(); // Save expanded inline chats

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

                        const isRegularCommit = commit.commitHash !== 'added' && commit.commitHash !== 'uncommitted';

                        const commitMessage = isRegularCommit
                        ? \`\${escapeHtml(commit.commitMessage)}\`
                        : \`\${escapeHtml(commit.commitMessage)}\`;


                        commitHeader.innerHTML = \`
                            <h3>\${escapeHtml(commitMessage)}</h3>
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
                                // When setting the data attribute for panelChat headers
                                panelChatHeader.setAttribute('data-panel-chat-id', \`\${commit.commitHash}-\${panelChat.id}\`); // Add data attribute for identification
                                panelChatHeader.innerHTML = \`
                                    Title: \${escapeHtml(panelChat.customTitle)}
                                    <button class="delete-panelchat-button" data-id="\${escapeHtml(panelChat.id)}" title="Delete PanelChat">🗑️</button>
                                    <button 
                                        class="append-context-button" 
                                        data-commit="\${escapeHtml(commit.commitHash)}" 
                                        data-id="\${escapeHtml(panelChat.id)}" 
                                        title="Append to context"
                                    >
                                        📄
                                    </button>
                                \`;

                                // Determine if the commit is an uncommitted change
                                const isUnadded = commit.commitHash === 'uncommitted';

                                if (isUnadded) {
                                    // Add Write Chat Button for Uncommitted Changes
                                    panelChatHeader.innerHTML += \`
                                        <button 
                                            class="write-chat-button" 
                                            data-panel-chat-id="\${escapeHtml(panelChat.id)}" 
                                            title="Write PanelChat to Stashed State"
                                        >
                                            ➕
                                        </button>
                                    \`;
                                } else if (commit.commitHash === 'added') {
                                    // Add Remove Chat Button for Added Changes
                                    panelChatHeader.innerHTML += \`
                                        <button 
                                            class="remove-chat-button" 
                                            data-panel-chat-id="\${escapeHtml(panelChat.id)}" 
                                            title="Remove PanelChat from Stashed State"
                                        >
                                            ➖
                                        </button>
                                    \`;
                                }

                                panelChatDiv.appendChild(panelChatHeader);

                                // Create panel-chat-details container
                                const panelChatDetails = document.createElement('div');
                                panelChatDetails.className = 'panel-chat-details';

                                // PanelChat info (customTitle, ai_editor, etc.)
                                const panelChatInfo = document.createElement('div');
                                panelChatInfo.className = 'panel-chat-info';
                                panelChatInfo.innerHTML = \`
                                    <strong>Author:</strong> \${escapeHtml(commit.author || 'Unknown')}<br>
                                    <strong>AI Editor:</strong> \${escapeHtml(panelChat.ai_editor)}<br>
                                    <strong>Created On:</strong> \${new Date(panelChat.created_on).toLocaleString()}<br>
                                \`;
                                panelChatDetails.appendChild(panelChatInfo);

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

                                    // Determine if the commit is an uncommitted change
                                    const isUnaddedMessage = commit.commitHash === 'uncommitted';

                                    // Conditionally add Write or Remove Chat Buttons
                                    if (isUnaddedMessage) {
                                        // Add Write Chat Button for Messages
                                        const writeBtn = document.createElement('button');
                                        writeBtn.className = 'write-chat-button';
                                        writeBtn.setAttribute('data-message-id', messageEntry.id); // Changed to 'data-message-id'
                                        writeBtn.title = 'Write Message to Stashed State';
                                        writeBtn.textContent = '➕';
                                        messageContainer.appendChild(writeBtn);
                                    } else if (commit.commitHash === 'added') {
                                        // Add Remove Chat Button for Messages
                                        const removeBtn = document.createElement('button');
                                        removeBtn.className = 'remove-chat-button';
                                        removeBtn.setAttribute('data-message-id', messageEntry.id); // Changed to 'data-message-id'
                                        removeBtn.title = 'Remove Message from Stashed State';
                                        removeBtn.textContent = '➖';
                                        messageContainer.appendChild(removeBtn);
                                    }

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
                                    console.log('Message Entry Context:', messageEntry.context);
                                    if (messageEntry.context && Array.isArray(messageEntry.context) && messageEntry.context.length > 0) {
                                        const contextDiv = document.createElement('div');
                                        contextDiv.className = 'context';
                                        contextDiv.style.fontSize = '0.8em';
                                        contextDiv.style.color = 'var(--vscode-descriptionForeground)';
                                        const humanReadableContext = messageEntry.context
                                        .filter(item => item && typeof item === 'object' && item.value && typeof item.value === 'object' && typeof item.value.human_readable === 'string')
                                        .map(item => {
                                            // Get the relative path
                                            const fullPath = item.value.human_readable;
                                            let relativePath = fullPath;
                                            
                                            if (workspaceFolderPath && fullPath.startsWith(workspaceFolderPath)) {
                                                relativePath = fullPath.slice(workspaceFolderPath.length + 1);
                                            }

                                            const link = document.createElement('a');
                                            link.href = '#';
                                            link.textContent = escapeHtml(relativePath);
                                            link.dataset.path = relativePath;
                                            link.classList.add('context-link'); 
                                            return link.outerHTML;
                                        })
                                        .join(', ');
                                        if (humanReadableContext) {
                                            contextDiv.innerHTML = \`<strong>Context:</strong> \${humanReadableContext}\`;
                                            messageContainer.appendChild(contextDiv);
                                        }
                                    }

                                    if (messageEntry.kv_store && 'file_paths' in messageEntry.kv_store) {
                                        const contextDiv = document.createElement('div');
                                        contextDiv.className = 'context';
                                        contextDiv.style.fontSize = '0.8em';
                                        contextDiv.style.color = 'var(--vscode-descriptionForeground)';
                                        const associatedFilePaths = messageEntry.kv_store.file_paths
                                        .map(filePath => {
                                            let relativePath = filePath;
                                            
                                            if (workspaceFolderPath && filePath.startsWith(workspaceFolderPath)) {
                                                relativePath = filePath.slice(workspaceFolderPath.length + 1);
                                            }

                                            const link = document.createElement('a');
                                            link.href = '#';
                                            link.textContent = escapeHtml(relativePath);
                                            link.dataset.path = relativePath;
                                            link.classList.add('context-link'); 
                                            return link.outerHTML;
                                        })
                                        .join(', ');
                                        if (associatedFilePaths) {
                                            contextDiv.innerHTML = \`<strong>Associated Files:</strong> \${associatedFilePaths}\`;
                                            messageContainer.appendChild(contextDiv);
                                        }
                                    }

                                    panelChatDetails.appendChild(messageContainer);
                                });

                                commitDetails.appendChild(panelChatDetails);
                                panelChatDiv.appendChild(panelChatDetails);

                                commitDetails.appendChild(panelChatDiv);
                            });
                        } else {
                            const noPanelChats = document.createElement('div');
                            noPanelChats.className = 'no-messages';
                            noPanelChats.textContent = 'No panelChats in this commit.';
                            commitDetails.appendChild(noPanelChats);
                        }

                        // Populate Inline Chats
                        if (commit.inlineChats && commit.inlineChats.length > 0 && commit.commitHash === 'added') {
                            // Create Inline Chats Container
                            const inlineChatsContainer = document.createElement('div');
                            inlineChatsContainer.className = 'inline-chats-container';

                            // Inline Chats Header
                            const inlineChatsHeader = document.createElement('div');
                            inlineChatsHeader.className = 'inline-chats-header';
                            inlineChatsHeader.innerHTML = \`
                                <h4>Inline Chats</h4>
                            \`;
                            inlineChatsContainer.appendChild(inlineChatsHeader);

                            // Inline Chats Details
                            const inlineChatsDetails = document.createElement('div');
                            inlineChatsDetails.className = 'inline-chats-details';
                            inlineChatsDetails.style.display = 'none'; // Initially collapsed
                            inlineChatsContainer.appendChild(inlineChatsDetails);

                            // Iterate through each inline chat
                            commit.inlineChats.forEach(inlineChat => {
                                // Create Inline Chat Container
                                const inlineChatDiv = document.createElement('div');
                                inlineChatDiv.className = 'inline-chat';

                                // Inline Chat Header
                                const inlineChatHeader = document.createElement('div');
                                inlineChatHeader.className = 'inline-chat-header';
                                inlineChatHeader.setAttribute('data-id', \`\${inlineChat.inline_chat_id}\`);
                                inlineChatHeader.innerHTML = \`
                                    <span>\${escapeHtml(inlineChat.prompt)}</span>
                                    <div>
                                        <button class="delete-inlinechat-button" data-id="\${escapeHtml(inlineChat.inline_chat_id)}" title="Delete Inline Chat">🗑️</button>
                                    </div>
                                \`;
                                inlineChatDiv.appendChild(inlineChatHeader);

                                // Inline Chat Details
                                const inlineChatDetails = document.createElement('div');
                                inlineChatDetails.className = 'inline-chat-details';

                                // Prompt
                                const promptDiv = document.createElement('div');
                                promptDiv.className = 'inline-chat-prompt';
                                promptDiv.innerHTML = \`<strong>Prompt:</strong> \${escapeHtml(inlineChat.prompt)}\`;
                                inlineChatDetails.appendChild(promptDiv);

                                // File Diffs
                                if (inlineChat.file_diff && inlineChat.file_diff.length > 0) {
                                    inlineChat.file_diff.forEach(file_diff => {
                                        const diffDiv = document.createElement('div');
                                        diffDiv.className = 'file-diff';
                                        diffDiv.innerHTML = \`
                                            <strong>File:</strong> \${escapeHtml(file_diff.file_path)}<br>
                                            <pre><code class="language-diff">\${file_diff.diffs.map(diff => escapeHtml(diff.value)).join('')}</code></pre>
                                        \`;
                                        inlineChatDetails.appendChild(diffDiv);
                                    });
                                }

                                inlineChatDiv.appendChild(inlineChatDetails);
                                inlineChatsDetails.appendChild(inlineChatDiv);
                            });

                            commitDetails.appendChild(inlineChatsContainer);
                        }
                        commitDiv.appendChild(commitDetails);
                        contentElement.appendChild(commitDiv);
                    });

                    // Attach event listeners for collapsible commits
                    attachCommitToggleListeners();

                    // Attach event listeners for collapsible panel chats
                    attachPanelChatToggleListeners(); // New function call

                    // Attach event listeners for delete, write, and remove buttons
                    attachButtonListeners();

                    attachLinkListeners();

                    attachInlineChatToggleListeners();
                } else {
                    const noCommits = document.createElement('div');
                    noCommits.className = 'no-commits';
                    noCommits.textContent = 'No commits found.';
                    contentElement.appendChild(noCommits);
                }

                // After updating the content
                restoreExpandedCommits();
                restoreExpandedPanelChats(); // Restore expanded panel chats
                restoreExpandedInlineChats();
                restoreInlineChatsExpandedState(); // Restore expanded inline chats state
                restoreScrollPosition();
                Prism.highlightAll();
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
