import * as vscode from 'vscode';
import * as Diff from 'diff';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';


export interface InlineStartInfo {
    fileName: string;
    content: string;
    lineCount: number;
    startTimestamp: string;
    startSelection: vscode.Position,
    endSelection: vscode.Position,
    selectionContent: string;
    parent_inline_chat_id: string | null;
}

export interface InlineChatInfo {
    inline_chat_id: string;
    fileName: string;
    content: string;
    lineCount: number;
    startTimestamp: string;
    startSelection: vscode.Position,
    endSelection: vscode.Position,
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

export function removeInlineChatInfo(inline_chat_id: string, fileChats: FileChats): FileChats {
    delete fileChats.inlineChats[inline_chat_id];
    return fileChats;
}

export function addInlineChatInfo(inlineChatInfo: InlineChatInfo, fileChats: FileChats): FileChats {
    fileChats.inlineChats[inlineChatInfo.inline_chat_id] = inlineChatInfo;
    return fileChats;
}

export function filenameToRelativePath(baseName: string): string {
    const fileName = baseName.replace(/\//g, "_") + ".json";
    return `.gait/${fileName}`;
}

export function filenameToStoragePath(baseName: string): string  {
    const relativePath = filenameToRelativePath(baseName);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspaceFolderPath = workspaceFolder?.uri.fsPath;

    return `${workspaceFolderPath}/${relativePath}`;
}

export function currentFileToStoragePath(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const document = editor.document;
        const baseName = vscode.workspace.asRelativePath(document.uri);
        return filenameToStoragePath(baseName);
    }
    return undefined;
}

export function loadFileChats(filepath: string): FileChats {
    let storagePath: string;
    try {
        storagePath = path.resolve(filenameToStoragePath(filepath));
        let fileContent = fs.readFileSync(storagePath, 'utf-8');
        const fileChats: FileChats = JSON.parse(fileContent);
        return fileChats;
    } catch (error) {
        return {
            fileName: filepath,
            inlineChats: {},
        };
    }
}

export function dumpFileChats(fileChat: FileChats): void {
    const filePath = path.resolve(filenameToStoragePath(fileChat.fileName));
    const fileContent = JSON.stringify(fileChat, null, 4);
    fs.writeFileSync(filePath, fileContent);
}

export function writeInlineChat(inlineChatInfo: InlineChatInfo){
    const filepath = inlineChatInfo.fileName;
    const fileChats = loadFileChats(filepath);
    const updatedFileChats = addInlineChatInfo(inlineChatInfo, fileChats);
    dumpFileChats(updatedFileChats);
}


export function removeInlineChat(filepath: string, inline_chat_id: string){
    const fileChats = loadFileChats(filepath);
    const updatedFileChats = removeInlineChatInfo(inline_chat_id, fileChats);
    dumpFileChats(updatedFileChats);
}
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

export function InlineStartToInlineChatInfo(inlineStartInfo: InlineStartInfo, diffs : Diff.Change[], prompt: string): InlineChatInfo {
    return {
        inline_chat_id :  uuidv4(),
        fileName: inlineStartInfo.fileName,
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