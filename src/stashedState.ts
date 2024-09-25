import fs from 'fs';
import path from 'path';
import { isStashedState, StashedState } from './types';
import vscode from 'vscode';
import { compressSync, decompressSync } from 'zstd-codec';

function stashedStateFilePath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found.');
        throw new Error('No workspace folder found.');
    }

    const repoPath = workspaceFolder.uri.fsPath;
    return path.join(repoPath, '.gait', 'stashedPanelChats.json');
}

export function readStashedState(): StashedState {
    const filePath = stashedStateFilePath();
    try {
        const compressedContent = fs.readFileSync(filePath);
        //const decompressedBuffer = decompressSync(compressedContent);
        //const fileContent = decompressedBuffer.toString('utf-8');
        const fileContent = compressedContent.toString('utf-8');
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

export function writeStashedState(stashedState: StashedState): void {
    const filePath = stashedStateFilePath();
    try {
        const jsonString = JSON.stringify(stashedState, null, 2);

        // Compress the JSON string using zstd-codec
        //const compressedBuffer = compressSync(Buffer.from(jsonString, 'utf-8'));

        // Write the compressed buffer to the file
        fs.writeFileSync(filePath, jsonString);
    } catch (error) {
        vscode.window.showErrorMessage(`Error writing stashed state: ${(error as Error).message}`);
        throw new Error('Error writing stashed state');
    }
}