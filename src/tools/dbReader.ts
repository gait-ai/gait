import { exec } from 'child_process';
import { promisify } from 'util';
import { debug } from '../debug';
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
        debug("Reading VSCode state from " + dbPath + " for key: " + key);
        const escapedDbPath = `"${dbPath}"`;
        const tempFilePath = path.join(os.tmpdir(), `vscode_state_${Date.now()}.csv`);
        
        let sqliteCommand = 'sqlite3';
        if (process.platform === 'win32') {
            debug("Using sqlite3_win.exe");
            sqliteCommand = path.join(__dirname, '..', 'bin', 'sqlite3_win.exe');
        }
        
        await execAsync(`"${sqliteCommand}" ${escapedDbPath} -readonly -csv "SELECT key, value FROM ItemTable WHERE key = '${key}';" > ${tempFilePath}`);

        const fileContent = await readFileAsync(tempFilePath, 'utf-8');
        
        const records = parse(fileContent, {
            columns: ['key', 'value'],
            skip_empty_lines: true,
        });

        await fs.promises.unlink(tempFilePath);

        if (records.length === 0) {
            debug("No records found for key: " + key);
            return null;
        }

        return JSON.parse(records[0].value);
    } catch (error) {
        debug(`Error querying SQLite DB: ${error}`);
        return null;
    }
}
