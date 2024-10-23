import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceFolderPath } from '../utils';

export async function excludeSearch(): Promise<void> {
    try {
        const workspacePath = getWorkspaceFolderPath();
        const vscodeFolderPath = path.join(workspacePath, '.vscode');
        const settingsFilePath = path.join(vscodeFolderPath, 'settings.json');
        
        let settings: any = { "search.exclude": {} };

        if (!fs.existsSync(vscodeFolderPath)) {
            fs.mkdirSync(vscodeFolderPath);
        }

        if (fs.existsSync(settingsFilePath)) {
            try {
                const settingsContent = fs.readFileSync(settingsFilePath, 'utf8');
                const settingsWithoutComments = settingsContent.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
                settings = JSON.parse(settingsWithoutComments);
                if (!settings['search.exclude']) {
                    settings['search.exclude'] = {};
                }
            } catch (error) {
                console.error('Error reading or parsing settings.json:', error);
                vscode.window.showErrorMessage('Failed to read or parse settings.json');
            }
        }

        if (!settings['search.exclude']['.gait/**'] || !settings['search.exclude']['**/gait_context.md']) {
            settings['search.exclude']['.gait/**'] = true;
            settings['search.exclude']['**/gait_context.md'] = true;
            fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2));
            vscode.window.showInformationMessage('Added .gait files to search exclusions in settings.json');
        }
    } catch (error: unknown) {
        if (error instanceof Error) {
            vscode.window.showErrorMessage(`Failed to exclude search: ${error.message}`);
        } else {
            vscode.window.showErrorMessage('Failed to exclude search: An unknown error occurred');
        }
    }
}
