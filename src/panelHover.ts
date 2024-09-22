import * as vscode from 'vscode';
import { PanelMatchedRange } from './types';
import { getIdToCommitInfo } from './panelgit';

/**
 * Creates hover content for a matched panel chat range.
 * @param matchedRange The matched range containing the panel chat and message information.
 * @param document The VSCode text document.
 * @returns A promise that resolves to a VSCode Hover object.
 */
export async function createPanelHover(matchedRange: PanelMatchedRange, document: vscode.TextDocument): Promise<vscode.ProviderResult<vscode.Hover>> {
    let markdown = new vscode.MarkdownString();
    let idToCommitInfo = undefined;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.warn('No workspace folder found.');
    } else {
        try {
            const repoPath = workspaceFolder.uri.fsPath;
            const filePath = '.gait/stashedPanelChats.json'; // Replace with your actual file path relative to repo
            idToCommitInfo = await getIdToCommitInfo(repoPath, filePath);
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

    // Display the commit information
    markdown.appendMarkdown(`**Commit**: ${commitMessage} by ${author}\n\n`);
    markdown.isTrusted = true;

    // Display the message text and response
    markdown.appendMarkdown(`## ${message.messageText}\n\n`);
    // Escape backticks and newlines in the response text
    const escapedResponseText = message.responseText.replace(/`/g, '\\`').replace(/\n/g, '\\n');
    markdown.appendMarkdown(`**Response**: ${escapedResponseText}\n\n`);

    const markdownData = {chats: [{commit: idToCommitInfo?.get(message.id), panelChat: panelChat}]}

    // Add action buttons at the end of the hover content
    const exportCommand = vscode.Uri.parse(`command:gait-copilot.exportPanelChatsToMarkdown?${encodeURIComponent(JSON.stringify(markdownData))}`);
    markdown.appendMarkdown(`\n\n[View in Markdown](${exportCommand})`);
    markdown.appendMarkdown(`\n\n`);
    const deleteCommand = vscode.Uri.parse(`command:gait-copilot.removePanelChat?${encodeURIComponent(JSON.stringify({
        panel_chat_id: panelChat.id,
        message_id: message.id
    }))}`);
    markdown.appendMarkdown(`[Delete This Panel Chat Annotation](${deleteCommand})`);

    // Add action button to continue the conversation
    const continueCommand = vscode.Uri.parse(`command:gait-copilot.registerGaitChatParticipant?${encodeURIComponent(JSON.stringify({
        contextString: JSON.stringify(panelChat.messages)
    }))}`);
    markdown.appendMarkdown(`\n\n[Continue This Conversation](${continueCommand})`);

    return new vscode.Hover(markdown);
}
