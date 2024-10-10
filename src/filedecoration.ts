import * as vscode from 'vscode';
import * as Inline from './inline';
import * as Diff from 'diff';
import * as levenshtein from 'fast-levenshtein';
import * as path from 'path';
import * as InlineHover from './inlinehover';
import { associateFileWithMessage } from './panelChats';
import { MessageEntry, PanelChat, PanelMatchedRange, StashedState } from './types';
import { readStashedState } from './stashedState';
import * as PanelHover from './panelHover';
import posthog from 'posthog-js';
import { getInlineChatFromGitHistory, getInlineChatIdToCommitInfo, getMessageFromGitHistory, GitHistoryData } from './panelgit';
type ColorType = 'blue' | 'green' | 'purple' | 'orange';

const colorHueMap: Record<ColorType, number> = {
    blue: 210,
    green: 110,
    purple: 270,
    orange: 30,
};

/**
 * Utility function to generate different colors with similar lightness.
 * Ensures colors are distinct by cycling through different hues.
 */
function generateColors(index: number): string {
    const colorTypes: ColorType[] = ['blue', 'green', 'purple', 'orange'];
    const hue = colorHueMap[colorTypes[index % colorTypes.length]];
    const saturation = 30;
    const lightness = 75;
    return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.2)`;  // Reduced opacity for shadow effect
}

/**
 * Extracts code blocks demarcated by triple backticks from a given text.
 * Handles optional language specifiers after the opening backticks.
 * @param text The text to extract code blocks from.
 * @returns An array of code blocks.
 */
function extractCodeBlocks(text: string): string[] {
    const codeBlockRegex = /```(?:\w+)?\s*([\s\S]*?)```/g;
    const codeBlocks: string[] = [];
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
        codeBlocks.push(match[1].trim());
    }
    return codeBlocks;
}

function isMeaningfulLine(line: string): boolean {
    return /[a-zA-Z0-9]/.test(line.trim()) && !line.trim().startsWith('import ');
}

export function matchDiffToCurrentFile(
    document: vscode.TextDocument,
    diff: Diff.Change[]
): vscode.Range[] {
    const documentLines = document.getText().split('\n');

    const addedLinesSet = new Set(
        diff.filter(change => change.added)
           .flatMap(change => change.value.split('\n').map(line => line.trim()))
           .filter(line => line.trim().length > 0)
    );

    const matchedLinesSet = new Set()

    if (addedLinesSet.size === 0) {
        return [];
    }

    const matchingLineNumbers: number[] = [];
    const lineOccurrences: Map<string, number> = new Map();

    for (let i = 0; i < documentLines.length; i++) {
        const trimmedLine = documentLines[i].trim();
        if (addedLinesSet.has(trimmedLine)) {
            matchingLineNumbers.push(i);
            matchedLinesSet.add(trimmedLine);
            lineOccurrences.set(trimmedLine, (lineOccurrences.get(trimmedLine) || 0) + 1);
        }
    }

    if (addedLinesSet.size < 5) {
        return matchingLineNumbers
            .filter(line => {
                const trimmedLine = documentLines[line].trim();
                return isMeaningfulLine(documentLines[line]) && lineOccurrences.get(trimmedLine) === 1;
            })
            .map(line => new vscode.Range(line, 0, line, documentLines[line].length));
    }


    if (addedLinesSet.size * 0.2 > matchedLinesSet.size) {
        return [];
    }

    let start = -1;
    let end = -1;
    const multiLineRanges: vscode.Range[] = [];

    for (let i = 0; i < matchingLineNumbers.length; i++) {
        const currentLine = matchingLineNumbers[i];
        const nextLine = matchingLineNumbers[i + 1];

        if (start === -1) {
            start = currentLine;
        }

        if (nextLine === undefined || nextLine !== currentLine + 1) {
            end = currentLine;

            let meaningfulLines = 0;
            for (let j = start; j <= end; j++) {
                const line = documentLines[j].trim();
                if (isMeaningfulLine(line)) {
                    meaningfulLines++;
                }
            }

            if (meaningfulLines >= 2) {
                for (let j = start; j <= end; j++) {
                    multiLineRanges.push(new vscode.Range(j, 0, j, documentLines[j].length));
                }
            } else if (meaningfulLines === 1) {
                const trimmedLine = documentLines[start].trim();
                if (lineOccurrences.get(trimmedLine) === 1 && isMeaningfulLine(trimmedLine)) {
                    multiLineRanges.push(new vscode.Range(start, 0, start, documentLines[start].length));
                }
            }

            start = -1;
            end = -1;
        }
    }

    return multiLineRanges;
}

type LineDecoration = { type: 'inline' | 'panel', inlineChat: Inline.InlineChatInfo | undefined, panelChat: PanelChat | undefined, messageId?: string, id: string }

export function generateDecorationMap(context: vscode.ExtensionContext, editor: vscode.TextEditor): Map<number, LineDecoration> {
    const decorationMap = new Map<number, LineDecoration>();

    const baseName = vscode.workspace.asRelativePath(editor.document.uri);
    if (baseName === 'gait_context.md' || baseName === '.gait/state.json') {
        return decorationMap;
    }

    const stashedState: StashedState = readStashedState(context);
    const inlineChats = stashedState.inlineChats;

    for (const chat of Object.values(inlineChats)) {
        for (const diff of chat.file_diff) {
            if (diff.file_path !== baseName) {
                continue;
            }
            const currentRanges = matchDiffToCurrentFile(editor.document, diff.diffs);
            currentRanges.forEach(range => {
                for (let line = range.start.line; line <= range.end.line; line++) {
                    decorationMap.set(line, { type: 'inline', inlineChat: chat, panelChat: undefined, messageId: undefined, id: chat.inline_chat_id });
                }
            });
        }
    }

    const allPanelChats = [...stashedState.panelChats, ...(context.workspaceState.get<PanelChat[]>('currentPanelChats') || [])];
    const currentPanelChats = allPanelChats.filter(chat => 
        !stashedState.deletedChats.deletedPanelChatIDs.includes(chat.id)
    );
    const currentMessages = currentPanelChats.reduce((acc, panelChat) => {
        panelChat.messages.forEach(message => {
            if (stashedState.deletedChats.deletedMessageIDs.includes(message.id)) {
                return;
            }
            const existingIndex = acc.findIndex(item => item.message.id === message.id);
            if (existingIndex === -1) {
                acc.push({ message, panelChat });
            }
        });
        return acc;
    }, [] as { message: MessageEntry, panelChat: PanelChat }[]);

    for (const {message, panelChat} of currentMessages) {
        if (message.kv_store && 'file_paths' in message.kv_store && !message.kv_store.file_paths.includes(baseName)) {
            continue;
        }
        const codeBlocks = extractCodeBlocks(message.responseText);
        for (const code of codeBlocks) {
            const currentRanges = matchDiffToCurrentFile(editor.document, [{value: code, added: true}] as Diff.Change[]);
            currentRanges.forEach(range => {
                for (let line = range.start.line; line <= range.end.line; line++) {
                    if (!decorationMap.has(line)) {
                        decorationMap.set(line, { type: 'panel', inlineChat: undefined, panelChat: panelChat, messageId: message.id, id: message.id });
                    }
                }
            });
        }
    }

    return decorationMap;
}

export function addDecorationForLine(
    context: vscode.ExtensionContext,
    editor: vscode.TextEditor,
    lineNumber: number,
    decorations: vscode.Disposable[],
    gitHistory: GitHistoryData
) {
    decorations.forEach(decoration => decoration.dispose());
    const decorationMap = context.workspaceState.get<Map<number, LineDecoration>>('decorationMap');
    
    if (!decorationMap) return [];

    const decoration = decorationMap.get(lineNumber);
    if (!decoration) return [];

    const range = new vscode.Range(lineNumber, editor.document.lineAt(lineNumber).text.length, lineNumber, editor.document.lineAt(lineNumber).text.length);

    let hoverMessage: vscode.MarkdownString | null = null;
    let afterText = '';

    const panelGitHistory = getMessageFromGitHistory(gitHistory);
    const inlineGitHistory = getInlineChatFromGitHistory(gitHistory);
    try {
        if (decoration.type === 'inline' && decoration.inlineChat) {
            hoverMessage = InlineHover.createHover(context, { range: new vscode.Range(lineNumber, 0, lineNumber, editor.document.lineAt(lineNumber).text.length), inlineChat: decoration.inlineChat }, editor.document, inlineGitHistory);
            afterText = InlineHover.getAfterText(decoration.inlineChat, inlineGitHistory);
        } else if (decoration.type === 'panel' && decoration.panelChat && decoration.messageId) {
            hoverMessage = PanelHover.createPanelHover(context, { range: new vscode.Range(lineNumber, 0, lineNumber, editor.document.lineAt(lineNumber).text.length), panelChat: decoration.panelChat, message_id: decoration.messageId }, editor.document, panelGitHistory);
            afterText = PanelHover.getAfterText(decoration.panelChat, decoration.messageId, panelGitHistory);
        }
    } catch (error) {
        console.error('Error creating hover message:', error);
    }

    // Filter decorationMap to get the lineNumbers that match the current decoration
    const matchingLineNumbers = Array.from(decorationMap.entries())
        .filter(([_, dec]) => 
            (decoration.type === 'inline' && dec.type === 'inline' && dec.inlineChat?.inline_chat_id === decoration.inlineChat?.inline_chat_id) ||
            (decoration.type === 'panel' && dec.type === 'panel' && dec.panelChat?.id === decoration.panelChat?.id && dec.messageId === decoration.messageId)
        )
        .map(([lineNum, _]) => lineNum);


    const decorationType = vscode.window.createTextEditorDecorationType({});
    const disposables: vscode.Disposable[] = [];

    const highlightDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(0, 255, 0, 0.1)',
        isWholeLine: true,
    });

    if (hoverMessage) {
        const decorationOptions: vscode.DecorationOptions = {
            range,
            renderOptions: {
                after: {
                    contentText: afterText,
                    margin: '0 0 0 3em',
                    color: '#A0A0A0',
                }
            },
        };
        const hoverProvider = vscode.languages.registerHoverProvider('*', {
            async provideHover(document, position, token) {
                let new_range = new vscode.Range(range.start, range.start.translate(0, afterText.length));
                if (!new_range.contains(position)) {
                    return;
                }
                const highlightRanges = matchingLineNumbers.map(lineNum => 
                    new vscode.Range(lineNum, 0, lineNum, document.lineAt(lineNum).text.length)
                );
                posthog.capture('hover');

                editor.setDecorations(highlightDecorationType, highlightRanges);
                disposables.push(highlightDecorationType);

                return new vscode.Hover(hoverMessage);
            }
        });
    
        // Add the new hover provider to the subscriptions
        context.subscriptions.push(hoverProvider);
        disposables.push(hoverProvider);
        editor.setDecorations(decorationType, [decorationOptions]);
        disposables.push(decorationType);
    }
    return disposables;
}

export function decorateActive(context: vscode.ExtensionContext, decorateAll: boolean = false) {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
        return [];
    }

    const decorationMap = generateDecorationMap(context, editor);
    context.workspaceState.update('decorationMap', decorationMap);

    let disposables: vscode.Disposable[] = [];
    if (decorateAll) {
        const uniqueDecorations = new Map<string, LineDecoration>();
        decorationMap.forEach((decoration, line) => {
            if (!uniqueDecorations.has(decoration.id)) {
                uniqueDecorations.set(decoration.id, decoration);
            }
        });

        let colorIndex = 0;
        uniqueDecorations.forEach((decoration, id) => {
            const color = generateColors(colorIndex);
            colorIndex++;

            const decorationType = vscode.window.createTextEditorDecorationType({
                backgroundColor: color,
                isWholeLine: true,
            });

            const ranges = Array.from(decorationMap.entries())
                .filter(([_, dec]) => dec.id === id)
                .map(([line, _]) => new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length));

            editor.setDecorations(decorationType, ranges);
            disposables.push(decorationType);
        });
    }
    return disposables
}

