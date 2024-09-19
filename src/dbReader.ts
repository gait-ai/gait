import { exec } from 'child_process';
import { promisify } from 'util';
import { parse } from 'csv-parse/sync';

const execAsync = promisify(exec);

/**
 * Interface representing the VSCode state.
 */
interface VSCodeState {
    [key: string]: any;
}

/**
 * Parses the VSCode state from the SQLite database.
 */
export async function parseVSCodeState(dbPath: string): Promise<VSCodeState> {
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
        throw error;
    }
}
