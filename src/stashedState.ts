import fs from 'fs';
import path from 'path';
import { isStashedState, StashedState } from './types';
import vscode from 'vscode';

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
        // Read the current file content as StashedState
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        let stashedState: StashedState;
        stashedState = JSON.parse(fileContent);
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
        fs.writeFileSync(filePath, JSON.stringify(stashedState, null, 2));
    } catch (error) {
        vscode.window.showErrorMessage(`Error writing stashed state: ${(error as Error).message}`);
        throw new Error('Error writing stashed state');
    }
}