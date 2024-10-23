import * as vscode from 'vscode';

export type TOOL = "VSCode" | "Cursor";


export function checkTool(context: vscode.ExtensionContext): TOOL {
    if (context.globalState.get("toolOverride")) {
        return context.globalState.get("toolOverride") as TOOL;
    }

    const bundleIdentifier = process.env.__CFBundleIdentifier || "";
    const ipcHook = process.env.VSCODE_IPC_HOOK || "";
    const cwd = process.env.VSCODE_CWD || "";
  
    if (bundleIdentifier.toLowerCase().includes("cursor") || ipcHook.toLowerCase().includes("cursor") || cwd.toLowerCase().includes("cursor")) {
      return "Cursor";
    } 
    return "VSCode";
}


export function registerSetToolCommand(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('gait.setTool', async () => {
        const tools: TOOL[] = ["VSCode", "Cursor"];
        const selectedTool = await vscode.window.showQuickPick(tools, {
            placeHolder: 'Select the AI codegen tool you are using'
        });
        if (selectedTool) {
            context.globalState.update("toolOverride", selectedTool);
            vscode.window.showInformationMessage(`Tool override set to: ${selectedTool}`);
        }
    });

    context.subscriptions.push(disposable);
}
