import * as vscode from 'vscode';

export function getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] | undefined {
    return vscode.workspace.workspaceFolders;
}


export function getRelativePath(document: vscode.TextDocument): string {
    return vscode.workspace.asRelativePath(document.uri);
}

export function getWorkspaceFolder(): vscode.WorkspaceFolder {
    const workspaceFolders = getWorkspaceFolders();
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace folder found');
    }
    return workspaceFolders[0];
}

export function getWorkspaceFolderPath(): string {
    const workspaceFolder = getWorkspaceFolder();
    return workspaceFolder.uri.fsPath;
}

export function getWorkspaceFoldersCount(): number {
    return getWorkspaceFolders()?.length ?? 0;
}
