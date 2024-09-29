import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { readStashedStateFromFile, stashedStateFilePath, writeStashedStateToFile } from './stashedState';
import { StashedState, isStashedState } from './types';

export async function handleMerge(context: vscode.ExtensionContext) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found.');
        return;
    }
    const filepath = stashedStateFilePath();
    const hasMergeConflicts = checkForMergeConflicts(filepath);
    if (hasMergeConflicts) {
        await resolveMergeConflicts(filepath);
    }
}

function checkForMergeConflicts(filepath: string): boolean {
    const diagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(filepath));
    return diagnostics.some(diagnostic => diagnostic.message.includes('Merge conflict'));
}

async function resolveMergeConflicts(filepath: string) {
    // Run git checkout --ours on the filepath
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);

    try {
        // Checkout our version
        await execAsync(`git checkout --ours "${filepath}"`);
        
        const ourState: StashedState = readStashedStateFromFile();

        // Checkout their version
        await execAsync(`git checkout --theirs "${filepath}"`);
        
        const theirState: StashedState = readStashedStateFromFile();;

        const mergedState = mergeStashedStates(ourState, theirState);

        if (mergedState) {
            // Write the merged state back to the file
            writeStashedStateToFile(mergedState);

            // Stage the merged file
            await execAsync(`git add "${filepath}"`);

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

    const text = fs.readFileSync(filepath, 'utf8');
}


function mergeStashedStates(ourState: StashedState, theirState: StashedState): StashedState | null {
    try {
        if (!isStashedState(ourState) || !isStashedState(theirState)) {
            throw new Error('Invalid StashedState format');
        }

        const mergedState: StashedState = {
            panelChats: [...ourState.panelChats, ...theirState.panelChats],
            inlineChats: [...ourState.inlineChats, ...theirState.inlineChats],
            schemaVersion: ourState.schemaVersion,
            deletedChats: {
                deletedMessageIDs: [...new Set([...ourState.deletedChats.deletedMessageIDs, ...theirState.deletedChats.deletedMessageIDs])],
                deletedPanelChatIDs: [...new Set([...ourState.deletedChats.deletedPanelChatIDs, ...theirState.deletedChats.deletedPanelChatIDs])]
            },
            kv_store: { ...ourState.kv_store, ...theirState.kv_store }
        };

        return JSON.stringify(mergedState, null, 2);
    } catch (error) {
        console.error('Error merging stashed states:', error);
        return null;
    }
}
