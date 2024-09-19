import * as vscode from 'vscode';
import { PanelMatchedRange } from './types';
import { getIdToCommitInfo, InlineCommitData } from './inlinegit';

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
            idToCommitInfo = await getIdToCommitInfo(workspaceFolder.uri.fsPath, vscode.workspace.asRelativePath(document.uri));
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

    const commitInfo = idToCommitInfo?.get(panelChat.id);
    const author = commitInfo?.author ?? "Unknown";
    const commitMessage = commitInfo?.commitMessage ?? "No commit message";

    markdown.supportHtml = true;
    markdown.isTrusted = true;

    // Display the commit information
    markdown.appendMarkdown(`**Commit**: ${commitMessage} by ${author}\n\n`);
    markdown.isTrusted = true;

    // Display the message text and response
    markdown.appendMarkdown(`**Message**: ${message.messageText}\n\n`);
    markdown.appendMarkdown(`**Response**: ${message.responseText}\n\n`);

    // Add action buttons at the end of the hover content
    markdown.appendMarkdown(`\n\n`);
    const deleteCommand = vscode.Uri.parse(`command:gait-copilot.removePanelChat?${encodeURIComponent(JSON.stringify({
        panel_chat_id: panelChat.id,
        message_id: message.id
    }))}`);
    markdown.appendMarkdown(`[Delete This Panel Chat Annotation](${deleteCommand})`);

    return new vscode.Hover(markdown);
}
