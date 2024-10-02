import * as vscode from 'vscode';
import * as Inline from './inline';
import * as Diff from 'diff';
import * as path from 'path';
import { CommitData, getInlineChatIdToCommitInfo } from './panelgit';
import { getRelativePath } from './utils';
import { getInlineParent } from './stashedState';

export async function createHoverContent(context: vscode.ExtensionContext, markdown: vscode.MarkdownString, inlineChat: Inline.InlineChatInfo, document: vscode.TextDocument, matchedRange: Inline.InlineMatchedRange | null = null, idToCommitInfo: Map<String, CommitData> | undefined): Promise<vscode.MarkdownString> {
    const { prompt, timestamp, parent_inline_chat_id } = inlineChat;

    // Find the diff that matches the current document's file path
    const documentPath = getRelativePath(document);
    const matchingDiff = inlineChat.file_diff.find(diff => path.normalize(diff.file_path) === path.normalize(documentPath));
    
    // Set diffs to the matching diff's diffs, or an empty array if no match found
    const diffs = matchingDiff ? matchingDiff.diffs : [];
    // Log an error if no matching diff is found
    if (!matchingDiff) {
        console.error(`No matching diff found for document path: ${documentPath}`);
        throw new Error(`No matching diff found for document path: ${documentPath}`);
    }

    const commitInfo = idToCommitInfo?.get(inlineChat.inline_chat_id);

    const author = commitInfo?.author ?? "You";
    const commitMessage = commitInfo?.commitMessage;
    const commitHash = commitInfo?.commitHash ?? "uncommitted chat";

    //markdown.supportHtml = true; // Allows HTML in the Markdown
    markdown.isTrusted = true; // Allows advanced Markdown features

    // Display the prompt with a smaller, circular user icon
    const timeDiffMs = new Date().getTime() - new Date(timestamp).getTime();
    const hoursSinceEdit = Math.floor(timeDiffMs / (1000 * 3600));
    const daysSinceEdit = Math.floor(timeDiffMs / (1000 * 3600 * 24));
    const timeAgo = daysSinceEdit === 0 ? `${hoursSinceEdit} hours ago` : daysSinceEdit === 1 ? 'yesterday' : `${daysSinceEdit} days ago`;
    markdown.appendMarkdown(`### ${author ?? "You"}: ${prompt} (${new Date(timestamp).toISOString().split('T')[0]}) (${timeAgo}) \n\n---\n`);
    markdown.appendMarkdown(`**Commit**: ${commitMessage} (${commitHash}) \n\n---\n`);
    // Flatten the diffs into individual lines
    let lineBasedDiffs: Diff.Change[] = [];
    diffs.forEach(diff => {
        const diffLines = diff.value.split('\n');
        diffLines.forEach(line => {
            lineBasedDiffs.push({
                value: line,
                added: diff.added,
                removed: diff.removed
            });
        });
    });

    // Find all lines that match `matchedLines`
    let surroundingLines: Diff.Change[] = lineBasedDiffs.filter(diff => diff.added || diff.removed);

    // Ensure that there are lines to display
    if (surroundingLines.length > 0) {
        const diffText = surroundingLines.map(change => {
            if (change.added) {return `+ ${change.value}`;}
            if (change.removed) {return `- ${change.value}`;}
            return `  ${change.value}`;
        }).join('\n');
        markdown.appendCodeblock('\n'+diffText, 'diff');
    }
    // Add action buttons at the end of the hover content
    markdown.appendMarkdown(`\n\n`);
    const deleteCommand = vscode.Uri.parse(`command:gait-copilot.removeInlineChat?${encodeURIComponent(JSON.stringify({
        filePath: vscode.workspace.asRelativePath(document.uri),
        inline_chat_id: inlineChat.inline_chat_id
    }))}`);
    const openFileCommand = vscode.Uri.parse(`command:gait-copilot.openFileWithContent?${encodeURIComponent(JSON.stringify({
        content: matchingDiff.before_content,
        title: `${path.basename(matchingDiff.file_path)} (at prompt time)`,
        languageId: vscode.window.activeTextEditor?.document.languageId,
        selectionStart: inlineChat.selection?.startSelection,
        selectionEnd: inlineChat.selection?.endSelection
    }))}`);
    
    markdown.appendMarkdown(`[View File at Prompt Time](${openFileCommand}) | ` +
                          `[Delete This Inline Chat Annotation](${deleteCommand})`);
    
    if (matchedRange) {
        const continueCommand = vscode.Uri.parse(`command:gait-copilot.continueInlineChat?${encodeURIComponent(JSON.stringify({
            parent_inline_chat_id: inlineChat.inline_chat_id,
            startLine: matchedRange.range.start.line,
            endLine: matchedRange.range.end.line
    }))}`);
        markdown.appendMarkdown(` | [Continue This Inline Chat Annotation](${continueCommand})`);
    }
    if (parent_inline_chat_id) {
        // Load the parent inline chat
        const parentInlineChat = getInlineParent(context, parent_inline_chat_id);
        if (!parentInlineChat) {
            console.error(`Parent inline chat not found for ID: ${parent_inline_chat_id}`);
        } else {
            markdown.appendMarkdown('\n\n---\n\n**Parent Chat:**\n\n');
            createHoverContent(context, markdown, parentInlineChat, document, null, idToCommitInfo);
        }
    }
    return markdown;
}

export async function createHover(context: vscode.ExtensionContext, matchedRange: Inline.InlineMatchedRange, document: vscode.TextDocument): Promise<vscode.ProviderResult<vscode.Hover>> {
    let markdown = new vscode.MarkdownString();

    let idToCommitInfo = undefined;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const filePath = '.gait/stashedGaitState2.json'; // Replace with your actual file path relative to repo

    if (!workspaceFolder) {
        console.warn('No workspace folder found.');
    } else {
        try {
            idToCommitInfo = await getInlineChatIdToCommitInfo(context, workspaceFolder.uri.fsPath, filePath);
        } catch (error) {
            console.warn(`Error getting commit info for ${document.fileName}: ${error}`);
        }
    }
    markdown = await createHoverContent(context, markdown, matchedRange.inlineChat, document, matchedRange, idToCommitInfo);
    return new vscode.Hover(markdown);
}
