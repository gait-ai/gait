import * as vscode from 'vscode';
import { PanelMatchedRange } from './types';
import { getIdToCommitInfo } from './panelgit';
import { STASHED_GAIT_STATE_FILE_NAME } from './constants';

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
            const filePath = `.gait/${STASHED_GAIT_STATE_FILE_NAME}`; // Replace with your actual file path relative to repo
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
 
    const continueCommand = vscode.Uri.parse(`command:gait-copilot.exportPanelChatsToMarkdown?${encodeURIComponent(
        JSON.stringify({data: encodedData, continue_chat: false}))}`);
    markdown.appendMarkdown(`[Continue Chat](${continueCommand})  |  `);
    const deleteCommand = vscode.Uri.parse(`command:gait-copilot.removePanelChat?${encodeURIComponent(JSON.stringify({
        panelChatId: panelChat.id,
    }))}`);
    markdown.appendMarkdown(`[Delete This Panel Chat Annotation](${deleteCommand})`);
    return new vscode.Hover(markdown);
}