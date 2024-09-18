import * as vscode from 'vscode';
import * as Inline from './inline';
import * as Diff from 'diff';
import * as levenshtein from 'fast-levenshtein';
import * as path from 'path';
import * as InlineHover from './inlinehover';
import { readStashedPanelChats } from './panelChats';
import { PanelMatchedRange, StashedState } from './types';
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
 * @param text The text to extract code blocks from.
 * @returns An array of code blocks.
 */
function extractCodeBlocks(text: string): string[] {
    const codeBlockRegex = /```([\s\S]*?)```/g;
    const codeBlocks: string[] = [];
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
        codeBlocks.push(match[1].trim());
    }
    return codeBlocks;
}

/**
 * Matches blocks of added lines from the diff to the current document.
 * @param document The VSCode text document.
 * @param diff The array of diff changes.
 * @param similarityThreshold The minimum similarity threshold for a match.
 * @returns An array of VSCode ranges that match the added diff blocks.
 */
export function matchDiffToCurrentFile(
    document: vscode.TextDocument,
    diff: Diff.Change[],
    similarityThreshold: number
): {ranges: vscode.Range, originalLines: string[], similarity: number }[] {
    const matchedRanges: {ranges: vscode.Range, originalLines: string[], similarity: number }[] = [];
    const documentLines = document.getText().split('\n');

    // Extract all added lines from the diff
    let addedLines = diff
        .filter(change => change.added)
        .flatMap(change => change.value.split('\n').map(line => line.trim()))
        .filter(line => line.length > 0); // Remove empty lines

    const minBlockSize = Math.min(addedLines.length, 2);

    while (addedLines.length >= minBlockSize) {
        let bestMatch = {
            similarity: 0,
            docStart: -1,
            blockSize: 0,
            addedStart: -1,
            addedBlockSize: 0,
        };

        // Iterate through possible block sizes starting from the maximum possible
        for (let blockSize = addedLines.length; blockSize >= minBlockSize; blockSize--) {
            
            for (let addedStart = 0; addedStart <= addedLines.length - blockSize; addedStart++) {
                const currentAddedBlock = addedLines.slice(addedStart, addedStart + blockSize);

                // Slide through the document to find the best matching block
                for (let docStart = 0; docStart <= documentLines.length - blockSize; docStart++) {
                    const currentDocBlock = documentLines.slice(docStart, docStart + blockSize).map(line => line.trim());
                    const similarity = computeBlockSimilarity(currentDocBlock, currentAddedBlock);

                    if (similarity > bestMatch.similarity) {
                        bestMatch = {
                            similarity,
                            docStart,
                            blockSize,
                            addedStart,
                            addedBlockSize: blockSize
                        };
                    }

                    // Early exit if perfect match is found
                    if (similarity === 1) {
                        break;
                    }
                }

                // Early exit if perfect match is found
                if (bestMatch.similarity === 1) {
                    break;
                }
            }

            // Early exit if perfect match is found
            if (bestMatch.similarity === 1) {
                break;
            }
        }

        // Check if the best match meets the similarity threshold
        if (bestMatch.similarity >= similarityThreshold && bestMatch.docStart !== -1) {
            const { docStart, blockSize, addedStart, addedBlockSize } = bestMatch;

            // Create a range covering the matched block in the document
            const startPos = new vscode.Position(docStart, 0);
            const endPos = new vscode.Position(docStart + blockSize - 1, documentLines[docStart + blockSize - 1].length);
            matchedRanges.push(
                {ranges: new vscode.Range(startPos, endPos),
                originalLines: addedLines.splice(addedStart, addedStart + addedBlockSize),
                similarity: bestMatch.similarity
                } );
            ;
        } else {
            // No more matches found that meet the threshold
            break;
        }
    }

    return matchedRanges;
}

/**
 * Computes the average similarity between two blocks of lines.
 * @param docBlock The block of lines from the document.
 * @param addedBlock The block of lines from the diff.
 * @returns The average similarity score between 0 and 1.
 */
function computeBlockSimilarity(docBlock: string[], addedBlock: string[]): number {
    if (docBlock.length !== addedBlock.length) {
        return 0;
    }

    let totalSimilarity = 0;

    for (let i = 0; i < docBlock.length; i++) {
        const docLine = docBlock[i];
        const addedLine = addedBlock[i];
        const distance = levenshtein.get(docLine, addedLine);
        const maxLength = Math.max(docLine.length, addedLine.length);
        const similarity = maxLength === 0 ? 1 : 1 - distance / maxLength;
        totalSimilarity += similarity;
    }

    return totalSimilarity / docBlock.length;
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
    const stashedState: StashedState = readStashedPanelChats(gaitDir);
    const fileChats = Inline.loadFileChats(baseName);

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
    for (const panelChat of stashedState.panelChats) {
        for (const message of panelChat.messages) {
            const codeBlocks = extractCodeBlocks(message.responseText);
            for (const code of codeBlocks) {
                const currentRanges = matchDiffToCurrentFile(editor.document, [{value: code, added: true}] as Diff.Change[], 0.8);
                if (currentRanges.length > 0) {
                    const color = generateColors(decorationIndex, 'orange');
                    decorationIndex += 1;

                    // Create a new decoration type with the unique color
                    currentRanges.forEach(range => {
                        rangesToPanel.push(...currentRanges.map(range => ({
                            range: range.ranges,
                            matchedLines: range.originalLines,
                            panelChat: panelChat,
                            message_id: message.id,
                            similarity: range.similarity
                          })));
                        addDecorationType(color, range.ranges);
                    });
                }
            }
        }
    }

    const rangesToInline: Inline.InlineMatchedRange[] = [];
    decorationIndex = 0;
    for (const chat of Object.values(fileChats.inlineChats)) {
        const currentRanges = matchDiffToCurrentFile(editor.document, chat.diffs, 0.8);
        if (currentRanges.length > 0) {

            const color = generateColors(decorationIndex);
            decorationIndex += 1;

            // Create a new decoration type with the unique color
            currentRanges.forEach(range => {
                rangesToInline.push({
                    range: range.ranges,
                    matchedLines: range.originalLines,
                    inlineChat: chat,
                    similarity: range.similarity
                });
                addDecorationType(color, range.ranges);
            });
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
                const hover = await PanelHover.createPanelHover(panelRanges[0], editor.document);
                return hover;
            }
            // Find the range with the highest similarity
            const highestSimilarityRange = ranges.reduce((max, current) => 
                current.similarity > max.similarity ? current : max
            );
            const hover = await InlineHover.createHover(highestSimilarityRange, editor.document);
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
