import fs from 'fs';
import path from 'path';
import { isStashedState, StashedState } from './types';
import vscode from 'vscode';
import zlib from 'zlib'; // Import the zlib library for Gzip compression
import { InlineChatInfo } from './inline';


/**
 * Returns the file path for the stashed state with a .gz extension.
 */
function stashedStateFilePath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found.');
        throw new Error('No workspace folder found.');
    }

    const repoPath = workspaceFolder.uri.fsPath;
    return path.join(repoPath, '.gait', 'stashedPanelChats.json.gz'); // Updated extension to .gz
}



export function readStashedState( context: vscode.ExtensionContext): StashedState {
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
 * Reads and decompresses the stashed state from the compressed .gz file.
 */
export function readStashedStateFromFile(): StashedState {
    const filePath = stashedStateFilePath();
    try {
        if (!fs.existsSync(filePath)) {
            // If the file does not exist, create an empty stashed state and write it to the file
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

        // Read the compressed file content as a buffer
        const compressedContent = fs.readFileSync(filePath);

        // Decompress the buffer using gzip
        const decompressedBuffer = zlib.gunzipSync(compressedContent);

        // Convert buffer to string and parse JSON
        const fileContent = decompressedBuffer.toString('utf-8');
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

export function writeStashedState( context: vscode.ExtensionContext, stashedState: StashedState): void {
    context.workspaceState.update('stashedState', stashedState);
    return;
}

/**
 * Compresses and writes the stashed state to the .gz file.
 */
export function writeStashedStateToFile(stashedState: StashedState): void {
    const filePath = stashedStateFilePath();
    try {
        // Convert the stashed state to a JSON string with indentation
        const jsonString = JSON.stringify(stashedState, null, 2);

        // Compress the JSON string using gzip
        const compressedBuffer = zlib.gzipSync(Buffer.from(jsonString, 'utf-8'));

        // Write the compressed buffer to the file
        fs.writeFileSync(filePath, compressedBuffer);
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
