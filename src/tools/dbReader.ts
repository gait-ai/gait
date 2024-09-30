import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { parse } from 'csv-parse/sync';

const execAsync = promisify(exec);
/**
 * Parses the VSCode state from the SQLite database.
 */
export async function readVSCodeState(dbPath: string, key: string): Promise<any> {
    try {
        const escapedDbPath = `"${dbPath}"`;
        const itemTableOutput = await execAsync(`sqlite3 ${escapedDbPath} -readonly -csv "SELECT key, value FROM ItemTable WHERE key = '${key}';"`);

        const records = parse(itemTableOutput.stdout, {
            columns: ['key', 'value'],
            skip_empty_lines: true,
        });

        if (records.length === 0) {
            return null;
        }

        return JSON.parse(records[0].value);
    } catch (error) {
        console.error(`Error querying SQLite DB: ${error}`);
        // vscode.window.showErrorMessage(`Error querying SQLite DB: ${error}`);
        // throw error;
        return null;
    }
}