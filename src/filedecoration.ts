import * as vscode from 'vscode';
import * as Inline from './inline';
import * as Diff from 'diff';
import * as path from 'path';
import * as InlineHover from './inlinehover';
import { associateFileWithMessage } from './panelChats';
import { PanelChat, PanelMatchedRange, StashedState } from './types';
import * as PanelHover from './panelHover';
type ColorType = 'blue' | 'green' | 'purple' | 'orange';

const colorHueMap: Record<ColorType, number> = {
    blue: 210,
    green: 120,
    purple: 270,
    orange: 30
};

/**
 * Utility function to generate different shades of a specified color.
 * Ensures colors are distinct by varying the lightness from light to dark.
 */
function generateColors(index: number, colorType: ColorType = 'blue'): string {
    const hue = colorHueMap[colorType];
    const saturation = 70; // Fixed saturation at 70%
    const totalShades = 10; // Total number of distinct shades
    const lightness = Math.max(30, 90 - (index % totalShades) * 6); // Vary lightness from 90% to 30%
    return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.5)`; // Different shades of blue, light to dark
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
           .filter(line => line.length > 0 && /[a-zA-Z0-9]/.test(line))
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
    let rangeStart = -1;

    for (let i = 0; i < matchingLineNumbers.length; i++) {
        if (rangeStart === -1) {
            rangeStart = matchingLineNumbers[i];
        } else if (matchingLineNumbers[i] !== matchingLineNumbers[i-1] + 1) {
            // End of a consecutive range
            ranges.push(new vscode.Range(
                new vscode.Position(rangeStart, 0),
                new vscode.Position(matchingLineNumbers[i-1], documentLines[matchingLineNumbers[i-1]].length)
            ));
            rangeStart = matchingLineNumbers[i];
        }
    }

    // Add the last range if there is one
    if (rangeStart !== -1) {
        ranges.push(new vscode.Range(
            new vscode.Position(rangeStart, 0),
            new vscode.Position(matchingLineNumbers[matchingLineNumbers.length-1], 
                                documentLines[matchingLineNumbers[matchingLineNumbers.length-1]].length)
        ));
    }
    // Filter out ranges that are a single line
    const multiLineRanges = ranges.filter(range => 
        range.start.line !== range.end.line
    );

    return multiLineRanges;
}


export function decorateActive(context: vscode.ExtensionContext) {
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

    const gaitDir = path.join(workspaceFolder.uri.fsPath, '.gait');
    const stashedState: StashedState = readStashedState(context);
    const inlineChats = stashedState.inlineChats;
    if (inlineChats === undefined) {
        vscode.window.showErrorMessage('No inline chats found');
        return;
    }

    const currentPanelChats = [
        ...(context.workspaceState.get<PanelChat[]>('currentPanelChats') || []),
        ...stashedState.panelChats
    ];

    const rangesToPanel: PanelMatchedRange[] = [];

    const decorationsMap: Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]> = new Map();
    function addDecorationType(color: string, range: vscode.Range) {
        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: color,
            overviewRulerColor: color,
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            // You can add more styling options here if needed
        });

        const decorationOptions: vscode.DecorationOptions[] = decorationsMap.get(decorationType) || [];
        decorationOptions.push({
            range: range,
        });
        decorationsMap.set(decorationType, decorationOptions);
    }

    let decorationIndex = 0;
    // Sort currentPanelChats by time in ascending order (latest first)
    currentPanelChats.sort((a, b) => {
        const timeA = a.created_on;
        const timeB = b.created_on;
        return new Date(timeA).getTime() - new Date(timeB).getTime();
    });
    console.log(JSON.stringify(currentPanelChats, null, 2));

    for (const panelChat of currentPanelChats) {
        for (const message of panelChat.messages) {
            if (message.kv_store && 'file_paths' in message.kv_store && !message.kv_store.file_paths.includes(baseName)) {
                continue;
            }
            const already_associated = (message.kv_store?.file_paths ?? []).includes(baseName);
            const codeBlocks = extractCodeBlocks(message.responseText);
            for (const code of codeBlocks) {
                const currentRanges = matchDiffToCurrentFile(editor.document, [{value: code, added: true}] as Diff.Change[]);
                if (!already_associated && currentRanges.reduce((sum, range) => sum + (range.end.line - range.start.line + 1), 0) > code.split('\n').length / 2) {
                    // If more than half of the code lines match, associate the file with the message
                    associateFileWithMessage(context, message.id, baseName, panelChat).catch(error => {
                        console.error(`Failed to associate file with message: ${error}`);
                    });
                }
                
                if (currentRanges.length > 0) {
                    const color = generateColors(decorationIndex);
                    decorationIndex += 1;

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
                        addDecorationType(color, range);
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
                decorationIndex += 1;

                // Create a new decoration type with the unique color
                currentRanges.forEach(range => {
                    rangesToInline.push({
                        range: range,
                        inlineChat: chat,
                    });
                    addDecorationType(color, range);
                });
            }
        }
    }

    // Apply all decoration types
    decorationsMap.forEach((decorationOptions, decorationType) => {
        editor.setDecorations(decorationType, decorationOptions);
        // Ensure decorationType is disposed when no longer needed
        context.subscriptions.push(decorationType);
    });

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
            // Find the range with the highest similarity
            const oldestRange = ranges.reduce((max, current) => 
                current.inlineChat.timestamp < max.inlineChat.timestamp ? current : max
            );
            const hover = await InlineHover.createHover(context, oldestRange, editor.document);
            return hover;
        }
    });

    // Add the new hover provider to the subscriptions
    context.subscriptions.push(hoverProvider);

    return {
        decorationTypes: Array.from(decorationsMap.keys()),
        hoverProvider: hoverProvider
    };
}
