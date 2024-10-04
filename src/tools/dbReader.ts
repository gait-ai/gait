import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);

/**
 * Parses the VSCode state from the SQLite database.
 */
export async function readVSCodeState(dbPath: string, key: string): Promise<any> {
    try {
        const escapedDbPath = `"${dbPath}"`;
        const tempFilePath = path.join(os.tmpdir(), `vscode_state_${Date.now()}.csv`);
        
        await execAsync(`sqlite3 ${escapedDbPath} -readonly -csv "SELECT key, value FROM ItemTable WHERE key = '${key}';" > ${tempFilePath}`);

        const fileContent = await readFileAsync(tempFilePath, 'utf-8');
        
        const records = parse(fileContent, {
            columns: ['key', 'value'],
            skip_empty_lines: true,
        });

        await fs.promises.unlink(tempFilePath);

        if (records.length === 0) {
            return null;
        }

        return JSON.parse(records[0].value);
    } catch (error) {
        console.error(`Error querying SQLite DB: ${error}`);
        return null;
    }
}