import * as vscode from 'vscode';
import * as Inline from './inline';
import * as Diff from 'diff';
import * as levenshtein from 'fast-levenshtein';
import * as path from 'path';
import * as InlineHover from './inlinehover';

/**
 * Utility function to generate different shades of blue color string.
 * Ensures colors are distinct by varying the lightness and saturation.
 */
function generateRandomColor(index: number): string {
    const hue = 210; // Blue hue
    const saturation = 70 + (index * 5) % 30; // Vary saturation between 70% and 100%
    const lightness = 70 + (index * 7) % 30; // Vary lightness between 60% and 90%
    return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.5)`; // Different shades of blue
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
    const fileChats = Inline.loadFileChats(baseName);

    const rangesToInline: Inline.MatchedRange[] = [];
    const decorationsMap: Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]> = new Map();
    let decorationIndex = 0;

    for (const chat of Object.values(fileChats.inlineChats)) {
        const currentRanges = matchDiffToCurrentFile(editor.document, chat.diffs, 0.8);
        if (currentRanges.length > 0) {

            const color = generateRandomColor(decorationIndex);
            decorationIndex += 1;

            // Create a new decoration type with the unique color
            currentRanges.forEach(range => {
                rangesToInline.push({
                    range: range.ranges,
                    matchedLines: range.originalLines,
                    inlineChat: chat,
                    similarity: range.similarity
                });
                const decorationType = vscode.window.createTextEditorDecorationType({
                    backgroundColor: color,
                    overviewRulerColor: color,
                    overviewRulerLane: vscode.OverviewRulerLane.Right,
                    // You can add more styling options here if needed
                });

                // Prepare the decoration options
                const decorationOptions: vscode.DecorationOptions[] = decorationsMap.get(decorationType) || [];
                decorationOptions.push({
                    range: range.ranges,
                });
                decorationsMap.set(decorationType, decorationOptions);
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
                return undefined;
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