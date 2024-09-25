import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StashedState, isStashedState } from './types';

export async function handleMerge(context: vscode.ExtensionContext) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found.');
        return;
    }

    const gaitFolder = path.join(workspaceFolder.uri.fsPath, '.gait');
    if (!fs.existsSync(gaitFolder)) {
        vscode.window.showInformationMessage('No .gait folder found. No merge conflicts to resolve.');
        return;
    }

    const files = fs.readdirSync(gaitFolder);
    for (const file of files) {
        if (path.extname(file) === '.json') {
            const filePath = path.join(gaitFolder, file);
            const document = await vscode.workspace.openTextDocument(filePath);
            const hasMergeConflicts = checkForMergeConflicts(document);
            if (hasMergeConflicts) {
                await resolveMergeConflicts(document);
            }
        }
    }
}

function checkForMergeConflicts(document: vscode.TextDocument): boolean {
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    return diagnostics.some(diagnostic => diagnostic.message.includes('Merge conflict'));
}

async function resolveMergeConflicts(document: vscode.TextDocument) {
    const text = document.getText();
    const { version1, version2 } = extractConflictingVersions(text);

    if (version1 && version2) {
        let mergedContent: string | null = null;
        
        if (document.fileName.endsWith('stashedPanelChats.json')) {
            mergedContent = mergeStashedStates(version1, version2);
        } 
        if (mergedContent) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), mergedContent);
            await vscode.workspace.applyEdit(edit);
            await document.save();
            vscode.window.showInformationMessage(`Merge conflicts in ${path.basename(document.fileName)} automatically resolved.`);
        }
    }
}

function extractConflictingVersions(content: string): { version1: string, version2: string } {
    const version1Parts: string[] = [];
    const version2Parts: string[] = [];

    const lines = content.split('\n');
    let inVersion1 = false;
    let inVersion2 = false;

    for (let line of lines) {
        if (line.startsWith('<<<<<<<')) {
            // Start of the first version (Version 1)
            inVersion1 = true;
            inVersion2 = false;
        } else if (line.startsWith('=======')) {
            // Switch to the second version (Version 2)
            inVersion1 = false;
            inVersion2 = true;
        } else if (line.startsWith('>>>>>>>')) {
            // End of conflict
            inVersion1 = false;
            inVersion2 = false;
        } else if (inVersion1) {
            // Collect Version 1 lines
            version1Parts.push(line);
        } else if (inVersion2) {
            // Collect Version 2 lines
            version2Parts.push(line);
        }
    }

    return {
        version1: version1Parts.join('\n'),
        version2: version2Parts.join('\n')
    };
}

function mergeStashedStates(ourVersion: string, theirVersion: string): string | null {
    try {
        const ourState: StashedState = JSON.parse(ourVersion);
        const theirState: StashedState = JSON.parse(theirVersion);

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
