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
    userComment?: string;
}


export interface InlineMatchedRange {
    range: vscode.Range;
    inlineChat: InlineChatInfo;
}


export function removeInlineChatInfo(inline_chat_id: string, stashedState: StashedState): StashedState {
    stashedState.inlineChats = stashedState.inlineChats.filter((inlineChat) => inlineChat.inline_chat_id !== inline_chat_id);
    return stashedState;
}

export function addInlineChatInfo(inlineChatInfo: InlineChatInfo, stashedState: StashedState): StashedState {
    stashedState.inlineChats.push(inlineChatInfo);
    return stashedState;
}

export function writeInlineChat(context: vscode.ExtensionContext, inlineChatInfo: InlineChatInfo){
    const stashedState = readStashedState(context);
    const updatedFileChats = addInlineChatInfo(inlineChatInfo, stashedState);
    writeStashedState(context, updatedFileChats);
}


export function removeInlineChat(context: vscode.ExtensionContext, inline_chat_id: string){
    const stashedState = readStashedState(context);
    const updatedFileChats = removeInlineChatInfo(inline_chat_id, stashedState);
    writeStashedState(context, updatedFileChats);
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

function isVscodePosition(obj: any): obj is vscode.Position {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof obj.line === 'number' &&
        typeof obj.character === 'number'
    );
}

// Type Guard for vscode.Range
function isVscodeRange(obj: any): obj is vscode.Range {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        isVscodePosition(obj.start) &&
        isVscodePosition(obj.end)
    );
}

// Type Guard for Diff.Change
function isDiffChange(obj: any): obj is Diff.Change {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof obj.value === 'string' &&
        (typeof obj.added === 'undefined' || typeof obj.added === 'boolean') &&
        (typeof obj.removed === 'undefined' || typeof obj.removed === 'boolean')
    );
}

// Type Guard for FileDiff
function isFileDiff(obj: any): obj is FileDiff {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof obj.file_path === 'string' &&
        Array.isArray(obj.diffs) &&
        obj.diffs.every(isDiffChange)
    );
}

// Interface for selection property
interface Selection {
    file_path: string;
    startSelection: vscode.Position;
    endSelection: vscode.Position;
    selectionContent: string;
}

// Type Guard for Selection
function isSelection(obj: any): obj is Selection {
    return (
        obj === null ||
        (
            obj !== null &&
            typeof obj === 'object' &&
            typeof obj.file_path === 'string' &&
            isVscodePosition(obj.startSelection) &&
            isVscodePosition(obj.endSelection) &&
            typeof obj.selectionContent === 'string'
        )
    );
}

export function isInlineChatInfo(obj: any): obj is InlineChatInfo {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        
        // Validate inline_chat_id
        typeof obj.inline_chat_id === 'string' &&
        
        // Validate file_diff
        Array.isArray(obj.file_diff) &&
        obj.file_diff.every(isFileDiff) &&
        
        // Validate selection
        isSelection(obj.selection) &&
        
        // Validate timestamp
        typeof obj.timestamp === 'string' &&
        
        // Validate prompt
        typeof obj.prompt === 'string' &&
        
        // Validate parent_inline_chat_id
        (typeof obj.parent_inline_chat_id === 'string' || obj.parent_inline_chat_id === null)
    );
}
