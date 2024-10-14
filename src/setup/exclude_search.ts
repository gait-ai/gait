import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function addGaitSearchExclusion(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const vscodePath = path.join(workspaceRoot, '.vscode');
    const settingsPath = path.join(vscodePath, 'settings.json');

    let settings: any = { "search.exclude": {} };

    if (!fs.existsSync(vscodePath)) {
        fs.mkdirSync(vscodePath);
    }

    if (fs.existsSync(settingsPath)) {
        try {
            const settingsContent = fs.readFileSync(settingsPath, 'utf8');
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
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        vscode.window.showInformationMessage('Added .gait files to search exclusions in settings.json');
    }
}
