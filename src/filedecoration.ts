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
    return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.5)`;
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

export function matchDiffToCurrentFile(
    document: vscode.TextDocument,
    diff: Diff.Change[]
): vscode.Range[] {
    const documentLines = document.getText().split('\n');

    // Extract all added lines from the diff and create a Set for faster lookup
    const addedLinesSet = new Set(
        diff.filter(change => change.added)
           .flatMap(change => change.value.split('\n').map(line => line.trim()))
           .filter(line => line.trim().length > 0)
    );

    if (addedLinesSet.size === 0) {
        return [];
    }

    const matchingLineNumbers: number[] = [];

    // Collect all matching line numbers
    for (let i = 0; i < documentLines.length; i++) {
        const trimmedLine = documentLines[i].trim();
        if (addedLinesSet.has(trimmedLine)) {
            matchingLineNumbers.push(i);
        }
    }

    // Merge consecutive line numbers into ranges
    const ranges: vscode.Range[] = [];
    // Filter out ranges that are a single line
    if (addedLinesSet.size < 3) {
        return ranges;
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

            // Check if the range is meaningful
            let meaningfulLines = 0;
            for (let j = start; j <= end; j++) {
                const line = documentLines[j].trim();
                if (/[a-zA-Z0-9]/.test(line)) {
                    meaningfulLines++;
                }
            }

            // If we have at least two meaningful lines, add the range
            if (meaningfulLines >= 2) {
                for (let j = start; j <= end; j++) {
                    multiLineRanges.push(new vscode.Range(j, 0, j, documentLines[j].length));
                }
            }

            start = -1;
            end = -1;
        }
    }

    return multiLineRanges;
}


export function decorateActive(context: vscode.ExtensionContext, decorations_active: boolean) {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
        return;
    }

    const baseName = vscode.workspace.asRelativePath(editor.document.uri);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.error('No workspace folder found');
        return;
    }

    const stashedState: StashedState = readStashedState(context);
    const inlineChats = stashedState.inlineChats;
    if (inlineChats === undefined) {
        vscode.window.showErrorMessage('No inline chats found');
        return;
    }
    const rangesToPanel: PanelMatchedRange[] = [];
    interface LineDecoration {
        timestamp: number;
        decorationType: vscode.TextEditorDecorationType;
        decorationOptions: vscode.DecorationOptions[];
    }

    const lineDecorations: Map<number, LineDecoration> = new Map();

    function addDecorationType(color: string, line: number, timestamp: number) {
        if (!decorations_active) {
            return;
        }
        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: color,
            overviewRulerColor: color,
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            // You can add more styling options here if needed
        });
        const decorationOptions: vscode.DecorationOptions[] = [{
            range: new vscode.Range(line, 0, line, editor!.document.lineAt(line).text.length),
        }];

        const existingDecoration = lineDecorations.get(line);
        if (!existingDecoration || timestamp < existingDecoration.timestamp) {
            lineDecorations.set(line, { timestamp, decorationType, decorationOptions });
        }
    }


    const decorationsMap: Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]> = new Map();

    let decorationIndex = 0;
    const currentPanelChats = [...stashedState.panelChats, ...(context.workspaceState.get<PanelChat[]>('currentPanelChats') || [])];

    const currentMessages = currentPanelChats.reduce((acc, panelChat) => {
        panelChat.messages.forEach(message => {
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
        const already_associated = (message.kv_store?.file_paths ?? []).includes(baseName);
        if (already_associated) {
            console.log("Already associated: ", message.id);
        }
        const codeBlocks = extractCodeBlocks(message.responseText);
        for (const code of codeBlocks) {
            const currentRanges = matchDiffToCurrentFile(editor.document, [{value: code, added: true}] as Diff.Change[]);
            if (!already_associated && currentRanges.reduce((sum, range) => sum + (range.end.line - range.start.line + 1), 0) > code.split('\n').length / 2) {
                // If more than half of the code lines match, associate the file with the message
                associateFileWithMessage(context, message, baseName, panelChat).catch(error => {
                    console.error(`Failed to associate file with message: ${error}`);
                });
            }
            decorationIndex += 1;
            if (currentRanges.length > 0) {
                const color = generateColors(decorationIndex);

                function lineInRangesToPanel(line: number) {
                    return rangesToPanel.some(range => 
                        range.range.start.line <= line && 
                        range.range.end.line >= line
                    );
                }
                function addRange(range: vscode.Range) {
                    rangesToPanel.push({
                        range: range,
                        panelChat: panelChat,
                        message_id: message.id,
                    });
                    addDecorationType(color, range.start.line, new Date(panelChat.created_on).getTime());
                }

                currentRanges.forEach(range => {
                    let currentStart = range.start.line;
                    let currentEnd = currentStart;

                    for (let i = range.start.line; i <= range.end.line; i++) {
                        if (lineInRangesToPanel(i)) {
                            if (currentStart !== currentEnd) {
                                addRange(new vscode.Range(currentStart, 0, currentEnd, editor.document.lineAt(currentEnd).text.length),
                                );
                            }
                            currentStart = i + 1;
                            currentEnd = i + 1;
                        } else {
                            currentEnd = i;
                        }
                    }

                    if (currentStart <= range.end.line) {
                        addRange(new vscode.Range(currentStart, 0, currentEnd, editor.document.lineAt(currentEnd).text.length),
            
                        );
                    }
                });
            }
        }
    }

    const rangesToInline: Inline.InlineMatchedRange[] = [];
    for (const chat of Object.values(inlineChats)) {
        for (const diff of chat.file_diff) {
            if (diff.file_path !== baseName) {
                continue;
            }
            const currentRanges = matchDiffToCurrentFile(editor.document, diff.diffs);
            if (currentRanges.length > 0) {
                const color = generateColors(decorationIndex);
                // Get content at document in the range

                // Create a new decoration type with the unique color
                currentRanges.forEach(range => {
                    rangesToInline.push({
                        range: range,
                        inlineChat: chat,
                    });
                    addDecorationType(color, range.start.line, new Date(chat.timestamp).getTime());
                });
            }
            decorationIndex += 1;
        }
    }

    // Apply all decoration types
    if (decorations_active) {
        lineDecorations.forEach((value) => {
            editor.setDecorations(value.decorationType, value.decorationOptions);
            // Ensure decorationType is disposed when no longer needed
            context.subscriptions.push(value.decorationType);
        });
    }

    const hoverProvider = vscode.languages.registerHoverProvider('*', {
        async provideHover(document, position, token) {
            const ranges = rangesToInline.filter(matchedRange => matchedRange.range.contains(position));
            if (ranges.length === 0) {
                const panelRanges = rangesToPanel.filter(matchedRange => matchedRange.range.contains(position));
                if (panelRanges.length === 0) {
                    return undefined;
                }
                const oldestRange = panelRanges.reduce((max, current) => 
                    current.panelChat.created_on < max.panelChat.created_on ? current : max
                );
                const hover = await PanelHover.createPanelHover(context, oldestRange, editor.document);
                return hover;
            }
            const oldestRange = ranges.reduce((max, current) => 
                current.inlineChat.timestamp < max.inlineChat.timestamp ? current : max
            );
            const hover = await InlineHover.createHover(context, oldestRange, editor.document);
            return hover;
        }
    });

    // Add the new hover provider to the subscriptions
    if (decorations_active) {
        context.subscriptions.push(hoverProvider);
    }

    return {
        decorationTypes: Array.from(lineDecorations.values()).map((value) => value.decorationType),
        hoverProvider: hoverProvider
    };
}
