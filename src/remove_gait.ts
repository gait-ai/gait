import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getWorkspaceFolderPath } from './utils';
import { GAIT_FOLDER_NAME } from "./constants";

export async function removeGait() {
    try {
        const workspacePath = getWorkspaceFolderPath();
        const gaitFolderPath = path.join(workspacePath, GAIT_FOLDER_NAME);
        const gitAttributesPath = path.join(workspacePath, '.gitattributes');
        const gitignorePath = path.join(workspacePath, '.gitignore');

        if (fs.existsSync(gaitFolderPath)) {
            fs.rmdirSync(gaitFolderPath, { recursive: true });
        }

        if (fs.existsSync(gitAttributesPath)) {
            let content = fs.readFileSync(gitAttributesPath, 'utf8');
            content = content.replace(/^.*gait.*$\n?/gm, '');
            if (!/[a-zA-Z0-9]/.test(content)) {
                fs.unlinkSync(gitAttributesPath);
            } else {
                fs.writeFileSync(gitAttributesPath, content.trim());
            }
        }

        if (fs.existsSync(gitignorePath)) {
            let content = fs.readFileSync(gitignorePath, 'utf8');
            content = content.replace(/^.*gait.*$\n?/gm, '');
            if (!/[a-zA-Z0-9]/.test(content)) {
                fs.unlinkSync(gitignorePath);
            } else {
                fs.writeFileSync(gitignorePath, content.trim());
            }
        }

        vscode.window.showInformationMessage('gait-related files and entries removed from .gitattributes and .gitignore.');
    } catch (error: unknown) {
        if (error instanceof Error) {
            vscode.window.showErrorMessage(`Failed to remove Gait: ${error.message}`);
        } else {
            vscode.window.showErrorMessage('Failed to remove Gait: An unknown error occurred');
        }
    }
}
