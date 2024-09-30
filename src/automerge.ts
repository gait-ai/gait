import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { readStashedStateFromFile, stashedStateFilePath, writeStashedState } from './stashedState';
import { PanelChat, StashedState, isStashedState } from './types';
import simpleGit, { SimpleGit } from 'simple-git';

export async function handleMerge(context: vscode.ExtensionContext) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        //vscode.window.showErrorMessage('No workspace folder found.');
        return;
    }
    const repoPath = workspaceFolder.uri.fsPath;

    const git: SimpleGit = simpleGit(repoPath);
    const filepath = stashedStateFilePath();
    const hasMergeConflicts = await checkForMergeConflicts(filepath, repoPath, git);
    if (hasMergeConflicts) {
        await resolveMergeConflicts(context, filepath, git);
    }
}
async function checkForMergeConflicts(filepath: string, repoPath: string, git: SimpleGit): Promise<boolean> {
    try {
        const output = await git.diff(['--name-only', '--diff-filter=U', '--relative']);
        const conflictingFiles = output.trim().split('\n');
        return conflictingFiles.includes(path.relative(repoPath, filepath));
    } catch (error) {
        console.error('Error checking for merge conflicts:', error);
        return false;
    }
}

async function resolveMergeConflicts(context: vscode.ExtensionContext, filepath: string, git: SimpleGit) {

    try {
        // Checkout our version
        await git.checkout(['--ours', filepath]);
        
        const ourState: StashedState = readStashedStateFromFile();

        // Checkout their version
        await git.checkout(['--theirs', filepath]);
        
        const theirState: StashedState = readStashedStateFromFile();;

        const mergedState = mergeStashedStates(ourState, theirState);

        if (mergedState) {
            // Write the merged state back to the file
            writeStashedState(context, mergedState);

            // Stage the merged file
            await git.add([filepath]);

            vscode.window.showInformationMessage('Merge conflicts resolved successfully.');
        } else {
            vscode.window.showErrorMessage('Failed to merge stashed states.');
        }
    } catch (error: unknown) {
        console.error('Error resolving merge conflicts:', error);
        if (error instanceof Error) {
            vscode.window.showErrorMessage(`Error resolving merge conflicts: ${error.message}`);
        } else {
            vscode.window.showErrorMessage('An unknown error occurred while resolving merge conflicts.');
        }
    }

}


function mergeStashedStates(ourState: StashedState, theirState: StashedState): StashedState | null {
    try {
        if (!isStashedState(ourState) || !isStashedState(theirState)) {
            throw new Error('Invalid StashedState format');
        }

        const panelChatMap = new Map<string, PanelChat>();

        ourState.panelChats.forEach(chat => panelChatMap.set(chat.id, chat));

        theirState.panelChats.forEach(chat => {
            if (panelChatMap.has(chat.id)) {
                panelChatMap.set(chat.id, mergePanelChats(panelChatMap.get(chat.id)!, chat));
            } else {
                panelChatMap.set(chat.id, chat);
            }
        });

        const mergedState: StashedState = {
            panelChats: Array.from(panelChatMap.values()),
            inlineChats: [...ourState.inlineChats, ...theirState.inlineChats],
            schemaVersion: ourState.schemaVersion,
            deletedChats: {
                deletedMessageIDs: [...new Set([...ourState.deletedChats.deletedMessageIDs, ...theirState.deletedChats.deletedMessageIDs])],
                deletedPanelChatIDs: [...new Set([...ourState.deletedChats.deletedPanelChatIDs, ...theirState.deletedChats.deletedPanelChatIDs])]
            },
            kv_store: { ...ourState.kv_store, ...theirState.kv_store }
        };

        return mergedState;
    } catch (error) {
        console.error('Error merging stashed states:', error);
        return null;
    }
}

function mergePanelChats(ourChat: PanelChat, theirChat: PanelChat): PanelChat {
    const mergedChat: PanelChat = {
        ai_editor: ourChat.ai_editor,
        id: ourChat.id,
        customTitle: ourChat.customTitle,
        parent_id: ourChat.parent_id,
        created_on: ourChat.created_on,
        messages: [],
        kv_store: { ...ourChat.kv_store, ...theirChat.kv_store }
    };
    // Choose the chat with more messages
    if (theirChat.messages.length > ourChat.messages.length) {
        mergedChat.messages = theirChat.messages;
    } else {
        mergedChat.messages = ourChat.messages;
    }
    return mergedChat;
}

