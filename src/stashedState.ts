import fs from 'fs';
import path from 'path';
import { isStashedState, PanelChat, StashedState } from './types';
import vscode from 'vscode';
import { InlineChatInfo } from './inline';
import { STASHED_GAIT_STATE_FILE_NAME } from './constants';
import { getWorkspaceFolder } from './utils';

/**
 * Returns the file path for the stashed state.
 */
export function stashedStateFilePath(): string {
    const workspaceFolder = getWorkspaceFolder()
    if (!workspaceFolder) {
        throw new Error('No workspace folder found.');
    }

    const repoPath = workspaceFolder.uri.fsPath;
    return path.join(repoPath, `.gait/${STASHED_GAIT_STATE_FILE_NAME}`);
}

export function readStashedState(context: vscode.ExtensionContext): StashedState {
    const stashedState = context.workspaceState.get<StashedState>('stashedState');
    if (!stashedState) {
        return {
            panelChats: [],
            inlineChats: [],
            schemaVersion: "1.0",
            deletedChats: {
                deletedMessageIDs: [],
                deletedPanelChatIDs: []
            },
            kv_store: {}
        };
    }
    return stashedState;
}

/**
 * Reads the stashed state from the file.
 */
export function readStashedStateFromFile(): StashedState {
    const filePath = stashedStateFilePath();
    try {
        if (!fs.existsSync(filePath)) {
            const emptyStashedState: StashedState = {
                panelChats: [],
                inlineChats: [],
                schemaVersion: "1.0",
                deletedChats: {
                    deletedMessageIDs: [],
                    deletedPanelChatIDs: []
                },
                kv_store: {}
            };

            writeStashedStateToFile(emptyStashedState);
        }

        // Read the file content as a string
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const stashedState: StashedState = JSON.parse(fileContent);

        if (!isStashedState(stashedState)) {
            throw new Error('Invalid stashed state');
        }

        return stashedState;
    } catch (error) {
        vscode.window.showErrorMessage(`Error reading stashed state: ${(error as Error).message}`);
        throw new Error('Error reading stashed state');
    }
}

export function writeStashedState(context: vscode.ExtensionContext, stashedState: StashedState): void {
    context.workspaceState.update('stashedState', stashedState);
    writeStashedStateToFile(stashedState);
    return;
}

export function writeChatToStashedState(context: vscode.ExtensionContext, newChat: PanelChat): void {
    const currentState = readStashedState(context);
    const existingChatIndex = currentState.panelChats.findIndex((chat) => chat.id === newChat.id);
    if (existingChatIndex !== -1) {
        const existingChat = currentState.panelChats[existingChatIndex];
        const newMessages = newChat.messages.filter((message) => !existingChat.messages.some((existingMessage) => existingMessage.id === message.id));
        existingChat.messages.push(...newMessages);
        currentState.panelChats[existingChatIndex] = existingChat;
    } else {
        currentState.panelChats.push(newChat);
    }
    writeStashedState(context, currentState);
}

export function removeMessageFromStashedState(context: vscode.ExtensionContext, message_id: string): void {
    const currentState = readStashedState(context);
    const chatIndex = currentState.panelChats.findIndex((chat) => chat.messages.some((message) => message.id === message_id));
    if (chatIndex === -1) {
        return;
    }
    const chat = currentState.panelChats[chatIndex];
    chat.messages = chat.messages.filter((message) => message.id !== message_id);
    currentState.panelChats[chatIndex] = chat;
    writeStashedState(context, currentState);
}

export function removePanelChatFromStashedState(context: vscode.ExtensionContext, panel_chat_id: string): void {
    const currentState = readStashedState(context);
    currentState.panelChats = currentState.panelChats.filter((chat) => chat.id !== panel_chat_id);
    writeStashedState(context, currentState);
}

/**
 * Writes the stashed state to the file.
 */
function writeStashedStateToFile(stashedState: StashedState): void {
    const filePath = stashedStateFilePath();
    try {
        // Convert the stashed state to a JSON string with indentation
        const jsonString = JSON.stringify(stashedState, null, 2);

        // Write the JSON string to the file
        fs.writeFileSync(filePath, jsonString, 'utf-8');
    } catch (error) {
        vscode.window.showErrorMessage(`Error writing stashed state: ${(error as Error).message}`);
        throw new Error('Error writing stashed state');
    }
}

export function getInlineParent(context: vscode.ExtensionContext, id: string): InlineChatInfo | undefined {
    const stashedState = readStashedState(context);
    const parent = stashedState.inlineChats.find((parent) => parent.inline_chat_id === id);
    if (!parent) {
        return undefined;
    }
    return parent;
}