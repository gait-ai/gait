import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { parse } from 'csv-parse/sync';
import * as path from 'path';

const execAsync = promisify(exec);
interface VSCodeState {
    [key: string]: any;
}

/**
 * Parses the VSCode state from the SQLite database.
 */
async function parseVSCodeState(dbPath: string): Promise<VSCodeState> {
    try {
        const escapedDbPath = `"${dbPath}"`;
        const itemTableOutput = await execAsync(`sqlite3 ${escapedDbPath} -readonly -csv "SELECT key, value FROM ItemTable;"`);

        const records = parse(itemTableOutput.stdout, {
            columns: ['key', 'value'],
            skip_empty_lines: true,
        });

        return records.reduce((state: VSCodeState, record: { key: string; value: string }) => {
            const { key, value } = record;
            try {
                state[key] = JSON.parse(value);
            } catch {
                state[key] = value;
            }
            return state;
        }, {});
    } catch (error) {
        console.error(`Error querying SQLite DB: ${error}`);
        vscode.window.showErrorMessage(`Error querying SQLite DB: ${error}`);
        throw error;
    }
}

/**
 * Reads a specific key from the VSCode state.
 */
export async function readVSCodeState(dbPath: string, key: string): Promise<any> {
    const state = await parseVSCodeState(dbPath);

    //vscode.window.showInformationMessage(`Read key ${key} from state: ${state[key]}`);
    if (key in state) {
        //vscode.window.showInformationMessage(`Read key ${key} from state: ${state[key]}`);
        return state[key];
    } else {
        //vscode.window.showErrorMessage(`Key ${key} not found in state.`);
        return null;
    }
}

