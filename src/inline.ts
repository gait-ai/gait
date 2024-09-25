import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import {diffLines} from 'diff';
import { readStashedState, writeStashedState } from './stashedState';
import { StashedState } from './types';

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

export interface FileDiff {
    file_path: string;
    before_content: string;
    after_content: string;
    diffs: Diff.Change[];
}

export interface InlineChatInfo {
    inline_chat_id: string,
    file_diff: FileDiff[],
    selection: {
        file_path: string;
        startSelection: vscode.Position,
        endSelection: vscode.Position,
        selectionContent: string;
    } | null,
    timestamp: string;
    prompt: string;
    parent_inline_chat_id: string | null;
}


export interface InlineMatchedRange {
    range: vscode.Range;
    matchedLines: string[];
    inlineChat: InlineChatInfo;
    similarity: number;
}


export function removeInlineChatInfo(inline_chat_id: string, stashedState: StashedState): StashedState {
    stashedState.inlineChats = stashedState.inlineChats.filter((inlineChat) => inlineChat.inline_chat_id !== inline_chat_id);
    return stashedState;
}

export function addInlineChatInfo(inlineChatInfo: InlineChatInfo, stashedState: StashedState): StashedState {
    stashedState.inlineChats.push(inlineChatInfo);
    return stashedState;
}

export function writeInlineChat(inlineChatInfo: InlineChatInfo){
    const stashedState = readStashedState();
    const updatedFileChats = addInlineChatInfo(inlineChatInfo, stashedState);
    writeStashedState(updatedFileChats);
}


export function removeInlineChat(inline_chat_id: string){
    const stashedState = readStashedState();
    const updatedFileChats = removeInlineChatInfo(inline_chat_id, stashedState);
    writeStashedState(updatedFileChats);
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

export function InlineStartToInlineChatInfo(inlineStartInfo: InlineStartInfo, after_content: string, prompt: string): InlineChatInfo {
    return {
        inline_chat_id: uuidv4(),
        file_diff: [{
            file_path: inlineStartInfo.fileName,
            before_content: inlineStartInfo.content,
            after_content: after_content,
            diffs: diffLines(inlineStartInfo.content, after_content)
        }],
        selection: {
            file_path: inlineStartInfo.fileName,
            startSelection: inlineStartInfo.startSelection,
            endSelection: inlineStartInfo.endSelection,
            selectionContent: inlineStartInfo.selectionContent
        },
        timestamp: new Date().toISOString(),
        prompt: prompt,
        parent_inline_chat_id: inlineStartInfo.parent_inline_chat_id
    };
}
