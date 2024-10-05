import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function addGaitSearchExclusion(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const settingsPath = path.join(workspaceRoot, '.vscode', 'settings.json');

    if (!fs.existsSync(settingsPath)) {
        return;
    }

    try {
        const settingsContent = fs.readFileSync(settingsPath, 'utf8');
        const settingsWithoutComments = settingsContent.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        let settings;
        try {
            settings = JSON.parse(settingsWithoutComments);
        } catch (jsonError) {
            console.error('Error parsing settings.json:', jsonError);
            vscode.window.showErrorMessage('Failed to parse settings.json');
            return;
        }

        if (!settings['search.exclude']) {
            settings['search.exclude'] = {};
        }

        if (!settings['search.exclude']['**/.gait'] || !settings['search.exclude']['**/gait_context.md']) {
            settings['search.exclude']['**/.gait'] = true;
            settings['search.exclude']['**/gait_context.md'] = true;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            vscode.window.showInformationMessage('Added .gait files to search exclusions in settings.json');
        }
    } catch (error) {
        console.error('Error updating settings.json:', error);
        vscode.window.showErrorMessage('Failed to update settings.json');
    }
}
