import * as vscode from 'vscode';

class Debug {
    private logs: string[] = [];

    debug(str: string) {
        this.logs.push(str);
    }

    formatLogs(): string {
        return this.logs.join('\n');
    }

    generateDebugFile() {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '', 'debug.log');
        fs.writeFileSync(filePath, this.formatLogs());
        vscode.window.showInformationMessage('Debug file generated successfully at ' + filePath);
    }
}
const debug_obj = new Debug();

export function debug(str: string) {
    debug_obj.debug(new Date().toISOString() + ' - ' + str);
}

export function generateDebugFile() {
    debug_obj.generateDebugFile();
}

export function registerDebugCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('gait.debugFile', () => {
        debug_obj.generateDebugFile();
    }));
}
