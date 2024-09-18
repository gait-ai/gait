import * as vscode from 'vscode';
import * as Inline from './inline';
import * as Diff from 'diff';
import * as path from 'path';
import { getIdToCommitInfo, InlineCommitData } from './inlinegit';
export async function createHoverContent(markdown: vscode.MarkdownString, inlineChat: Inline.InlineChatInfo, document: vscode.TextDocument, matchedRange: Inline.MatchedRange | null = null, idToCommitInfo: Map<String, InlineCommitData> | undefined): Promise<vscode.MarkdownString> {
    const { prompt, diffs, endTimestamp, parent_inline_chat_id } = inlineChat;
    const commitInfo = idToCommitInfo?.get(inlineChat.inline_chat_id);

    const author = commitInfo?.author ?? "You";
    const commitMessage = commitInfo?.commitMessage;
    const commitHash = commitInfo?.commitHash ?? "uncommitted chat";

    markdown.supportHtml = true; // Allows HTML in the Markdown
    markdown.isTrusted = true; // Allows advanced Markdown features

    // Display the prompt with a smaller, circular user icon
    const timeDiffMs = new Date().getTime() - new Date(endTimestamp).getTime();
    const hoursSinceEdit = Math.floor(timeDiffMs / (1000 * 3600));
    const daysSinceEdit = Math.floor(timeDiffMs / (1000 * 3600 * 24));
    const timeAgo = daysSinceEdit === 0 ? `${hoursSinceEdit} hours ago` : daysSinceEdit === 1 ? 'yesterday' : `${daysSinceEdit} days ago`;
    markdown.appendMarkdown(`**${author ?? "You"}**: ${prompt} (${new Date(endTimestamp).toISOString().split('T')[0]}) (${timeAgo}) \n\n---\n`);
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
    let surroundingLines: Diff.Change[] = [];
    if (matchedRange) {
        const { matchedLines } = matchedRange;
        lineBasedDiffs.forEach((diffLine, index) => {
            if (matchedLines.some(line => diffLine.value.includes(line))) {
                // Include the 3 surrounding lines before and after the match
                const start = Math.max(0, index - 3);
                const end = Math.min(lineBasedDiffs.length, index + 4); // +4 because slice is exclusive at the end
                surroundingLines = surroundingLines.concat(lineBasedDiffs.slice(start, end));
            }
        });
    } else {
        surroundingLines = diffs.filter(diff => diff.added || diff.removed).map(diff => ({...diff, value: diff.value.trim()}));
    }

    // Ensure that there are lines to display
    if (surroundingLines.length > 0) {
        // Remove duplicates (in case some surrounding lines are overlapping)
        surroundingLines = surroundingLines.filter((line, index, self) =>
            index === self.findIndex((d) => d.value === line.value)
        );
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
        content: inlineChat.content,
        title: `${path.basename(inlineChat.fileName)} (at prompt time)`,
        languageId: vscode.window.activeTextEditor?.document.languageId,
        selectionStart: inlineChat.startSelection,
        selectionEnd: inlineChat.endSelection
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
        const baseName = vscode.workspace.asRelativePath(document.uri);
        const fileChats = Inline.loadFileChats(baseName);
        const parentInlineChat = fileChats.inlineChats[parent_inline_chat_id];
        markdown.appendMarkdown('\n\n---\n\n**Parent Chat:**\n\n');
        createHoverContent(markdown, parentInlineChat, document, null, idToCommitInfo);
    }
    return markdown;
}

export async function createHover(matchedRange: Inline.MatchedRange, document: vscode.TextDocument): Promise<vscode.ProviderResult<vscode.Hover>> {
    let markdown = new vscode.MarkdownString();
    let idToCommitInfo = undefined;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.warn('No workspace folder found.');
    } else {
        try {
            idToCommitInfo = await getIdToCommitInfo(workspaceFolder.uri.fsPath, Inline.filenameToRelativePath(vscode.workspace.asRelativePath(document.uri)));
        } catch (error) {
            console.warn(`Error getting commit info for ${document.fileName}: ${error}`);
        }
    }
    markdown = await createHoverContent(markdown, matchedRange.inlineChat, document, matchedRange, idToCommitInfo);
    return new vscode.Hover(markdown);
}
