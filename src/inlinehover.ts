import * as vscode from 'vscode';
import * as Inline from './inline';
import * as Diff from 'diff';
import * as path from 'path';
import { CommitData, getInlineChatFromGitHistory, getInlineChatIdToCommitInfo, GitHistoryData } from './panelgit';
import { getRelativePath } from './utils';
import { getInlineParent } from './stashedState';
import { STASHED_GAIT_STATE_FILE_NAME } from './constants';

function getTimeAgo(timestamp: string): string {
    const timeDiffMs = new Date().getTime() - new Date(timestamp).getTime();
    const hoursSinceEdit = Math.floor(timeDiffMs / (1000 * 3600));
    const daysSinceEdit = Math.floor(timeDiffMs / (1000 * 3600 * 24));
    return daysSinceEdit === 0 ? `${hoursSinceEdit} hours ago` : daysSinceEdit === 1 ? 'yesterday' : `${daysSinceEdit} days ago`;
}

export function createHoverContent(context: vscode.ExtensionContext, markdown: vscode.MarkdownString, inlineChat: Inline.InlineChatInfo, document: vscode.TextDocument, matchedRange: Inline.InlineMatchedRange | null = null, idToCommitInfo: Map<String, CommitData> | undefined): vscode.MarkdownString {
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

    // Add action buttons at the end of the hover content
    const deleteCommand = vscode.Uri.parse(`command:gait.removeInlineChat?${encodeURIComponent(JSON.stringify({
        filePath: vscode.workspace.asRelativePath(document.uri),
        inline_chat_id: inlineChat.inline_chat_id
    }))}`);
    
    markdown.appendMarkdown(`[Delete Inline Chat ](${deleteCommand})`);
    markdown.appendMarkdown(`\n\n`);
    const timeAgo = getTimeAgo(timestamp);
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

export function createHover(context: vscode.ExtensionContext, matchedRange: Inline.InlineMatchedRange, document: vscode.TextDocument, idToCommitInfo: Map<String, CommitData>): vscode.MarkdownString {
    let markdown = new vscode.MarkdownString();

    markdown = createHoverContent(context, markdown, matchedRange.inlineChat, document, matchedRange, idToCommitInfo);
    return markdown;
}

export function getAfterText(inlineChat: Inline.InlineChatInfo, gitHistory: Map<string, CommitData>): string {
    let afterText = '';

    if (inlineChat.prompt) {
        afterText += `"${inlineChat.prompt.slice(0, 30)}${inlineChat.prompt.length > 30 ? '...' : ''}"`;
    }
    if (gitHistory && gitHistory.get(inlineChat.inline_chat_id)) {
        const commitData = gitHistory.get(inlineChat.inline_chat_id);
        if (commitData) {
            const { author, date } = commitData;
            const timeAgo = getTimeAgo(date.toISOString());

            afterText += ` - ${author}: ${timeAgo} - ${inlineChat.prompt.slice(0, 30)}${inlineChat.prompt.length > 30 ? '...' : ''}`;
        }
    }

    return afterText.trim();
}
