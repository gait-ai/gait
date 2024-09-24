import * as vscode from 'vscode';
import * as Diff from 'diff';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { readConsolidatedGaitData, writeConsolidatedGaitData } from './types';

const GAIT_FOLDER_NAME = '.gait';

// No changes needed for InlineStartInfo
export interface InlineStartInfo {
    fileName: string;
    content: string;
    lineCount: number;
    startTimestamp: string;
    startSelection: vscode.Position;
    endSelection: vscode.Position;
    selectionContent: string;
    parent_inline_chat_id: string | null;
}

// Removed `fileName` from InlineChatInfo
export interface InlineChatInfo {
    inline_chat_id: string;
    content: string;
    lineCount: number;
    startTimestamp: string;
    startSelection: vscode.Position;
    endSelection: vscode.Position;
    selectionContent: string;
    endTimestamp: string;
    prompt: string;
    diffs: Diff.Change[];
    parent_inline_chat_id: string | null;
}

export interface InlineMatchedRange {
    range: vscode.Range;
    matchedLines: string[];
    inlineChat: InlineChatInfo;
    similarity: number;
}

export interface FileChats {
    fileName: string;
    inlineChats: { [key: string]: InlineChatInfo };
}

// No changes needed for removeInlineChatInfo
export function removeInlineChatInfo(inline_chat_id: string, fileChats: FileChats): FileChats {
    delete fileChats.inlineChats[inline_chat_id];
    return fileChats;
}

// No changes needed for addInlineChatInfo
export function addInlineChatInfo(inlineChatInfo: InlineChatInfo, fileChats: FileChats): FileChats {
    fileChats.inlineChats[inlineChatInfo.inline_chat_id] = inlineChatInfo;
    return fileChats;
}

export function loadFileChats(filepath: string): FileChats {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error('No workspace folder found');
        }
  
        const gaitDir = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);

        const consolidatedData = readConsolidatedGaitData(gaitDir);
        const existingFileChats = consolidatedData.fileChats.find((fileChat: FileChats) => fileChat.fileName === filepath);
        if (!existingFileChats) {
            return {
                fileName: filepath,
                inlineChats: {},
            };
        }
        return existingFileChats;
    } catch (error) {
        return {
            fileName: filepath,
            inlineChats: {},
        };
    }
}

// export function dumpFileChats(fileChat: FileChats): void {
//     const filePath = path.resolve(filenameToStoragePath(fileChat.fileName));
//     const fileContent = JSON.stringify(fileChat, null, 4);
//     fs.writeFileSync(filePath, fileContent);
// }

// Modified writeInlineChat to accept `filepath` as a separate parameter
export function writeInlineChat(filepath: string, inlineChatInfo: InlineChatInfo) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error('No workspace folder found');
      }

    const gaitDir = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
    const consolidatedData = readConsolidatedGaitData(gaitDir);

    const existingFileChats = consolidatedData.fileChats.find((fileChat: FileChats) => fileChat.fileName === filepath);
    if (existingFileChats) {
        existingFileChats.inlineChats[inlineChatInfo.inline_chat_id] = inlineChatInfo;
    } else {
        const newFileChats: FileChats = {
            fileName: filepath,
            inlineChats: {
                [inlineChatInfo.inline_chat_id]: inlineChatInfo
            }
        };
        consolidatedData.fileChats.push(newFileChats);
    }

    writeConsolidatedGaitData(gaitDir, consolidatedData);
}

// Modified removeInlineChat to remove dependency on `inlineChatInfo.fileName`
export async function removeInlineChat(filename: string, inline_chat_id: string): Promise<void> {
    try {
        // Read the existing consolidated gait data
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error('No workspace folder found');
        }
  
        const gaitDir = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);

        const consolidatedData = readConsolidatedGaitData(gaitDir);

        // Ensure inlineChats is an array
        if (!Array.isArray(consolidatedData.fileChats)) {
            console.warn(`inlineChats property is missing or not an array in consolidatedGaitData.json. No inline chats to remove.`);
            return;
        }

        // Find the index of the inline chat to remove
        const existingFileChats = consolidatedData.fileChats.find((fileChat: FileChats) => fileChat.fileName === filename);
        if (!existingFileChats) {
            console.log(`No inline chats found for file ${filename}.`);
            return;
        }
        if (!(inline_chat_id in existingFileChats.inlineChats)) {
            console.warn(`inlineChat with id ${inline_chat_id} not found.`);
            return;
        }

        delete existingFileChats.inlineChats[inline_chat_id];
        console.log(`Removed inlineChat with id ${inline_chat_id} from inlineChats.`);

        // Write the updated consolidated gait data back to the file
        await writeConsolidatedGaitData(gaitDir, consolidatedData);

        console.log(`Successfully updated consolidatedGaitData.json after removing inlineChat.`);
    } catch (error) {
        console.error(`Error removing inlineChat with id ${inline_chat_id}:`, error);
        vscode.window.showErrorMessage(`Failed to remove inlineChat: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}

// No changes needed for type guards
export function isInlineStartInfo(obj: unknown): obj is InlineStartInfo {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'fileName' in obj &&
        'content' in obj &&
        'lineCount' in obj &&
        'startTimestamp' in obj &&
        'startSelection' in obj &&
        'endSelection' in obj &&
        'selectionContent' in obj &&
        'parent_inline_chat_id' in obj &&
        typeof (obj as InlineStartInfo).fileName === 'string' &&
        typeof (obj as InlineStartInfo).content === 'string' &&
        typeof (obj as InlineStartInfo).lineCount === 'number' &&
        typeof (obj as InlineStartInfo).startTimestamp === 'string' &&
        typeof (obj as InlineStartInfo).startSelection === 'object' &&
        typeof (obj as InlineStartInfo).endSelection === 'object' &&
        typeof (obj as InlineStartInfo).selectionContent === 'string'
    );
}

// Modified InlineStartToInlineChatInfo to exclude `fileName`
export function InlineStartToInlineChatInfo(inlineStartInfo: InlineStartInfo, diffs : Diff.Change[], prompt: string): InlineChatInfo {
    return {
        inline_chat_id :  uuidv4(),
        content: inlineStartInfo.content,
        lineCount: inlineStartInfo.lineCount,
        startTimestamp: inlineStartInfo.startTimestamp,
        startSelection: inlineStartInfo.startSelection,
        endSelection: inlineStartInfo.endSelection,
        selectionContent: inlineStartInfo.selectionContent,
        endTimestamp: new Date().toISOString(),
        prompt: prompt,
        diffs: diffs,
        parent_inline_chat_id: inlineStartInfo.parent_inline_chat_id,
    };
}
