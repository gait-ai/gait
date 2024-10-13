import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { readStashedState, writeStashedState } from './stashedState';

export function getRelativePath(document: vscode.TextDocument): string {
    return vscode.workspace.asRelativePath(document.uri);
}

export async function calculateTotalRepoLines(context: vscode.ExtensionContext): Promise<number> {
    // Get the workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace folder found');
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Initialize simple-git with the workspace root
    const git: SimpleGit = simpleGit(workspaceRoot);

    let repoRoot = workspaceRoot;

    let totalLines = 0;

    // Get list of tracked files
    const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib'];

    const trackedFiles = await git.raw(['ls-files']);
    const trackedFilePaths = trackedFiles.split('\n').filter(filePath => 
        !filePath.includes('.gait') && 
        !filePath.includes('gait_context.md') && 
        !filePath.includes('.git') && 
        !filePath.includes('package-lock.json') && 
        !filePath.includes('yarn.lock')
    ).filter(filePath => {
        const ext = path.extname(filePath).toLowerCase();
        return !binaryExtensions.includes(ext);
    });
    
    for (const filePath of trackedFilePaths) {
        const fullPath = path.join(repoRoot.trim(), filePath);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const data = fs.readFileSync(fullPath, 'utf-8');
            // Filter out empty lines
            totalLines += data.split('\n').filter(line => line.trim() !== '').length;
        }
    }

    return totalLines;
}

export async function updateTotalRepoLineCount(context: vscode.ExtensionContext): Promise<void> {
    const totalLines = await calculateTotalRepoLines(context);
    const currentState = readStashedState(context);
    currentState.kv_store["total_repo_line_count"] = totalLines;
    writeStashedState(context, currentState);
}
