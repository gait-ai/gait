import * as vscode from 'vscode';

export function getRelativePath(document: vscode.TextDocument): string {
    return vscode.workspace.asRelativePath(document.uri);
}
