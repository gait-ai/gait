import fs from 'fs';
import path from 'path';
import vscode from 'vscode';
import { TOOL } from './ide';

interface Keybinding {
    key: string;
    command: string;
    when?: string;
}

export function generateKeybindings(context: vscode.ExtensionContext, tool: TOOL) {
    let newKeybindings: Keybinding[] = [];

    const sharedKeybindings = [{
        key: "cmd+g",
        command: "gait-copilot.toggleDecorations",
    }]
    if (tool === "Cursor") {
        newKeybindings = [{
                key: "cmd+e",
                command: "aipopup.action.modal.generate",
                when: "editorFocus && !composerBarIsVisible && !composerControlPanelIsVisible"
            },
            {
                key: "cmd+k",
                command: "-aipopup.action.modal.generate",
                when: "editorFocus && !composerBarIsVisible && !composerControlPanelIsVisible"
            },
            {
                key: "cmd+e",
                command: "composer.startComposerPrompt",
                when: "composerIsEnabled"
            },
            {
                key: "cmd+k",
                command: "-composer.startComposerPrompt",
                when: "composerIsEnabled"
            },
            {
                command: "gait-copilot.startInlineChat",
                key: "cmd+k",
                when: "editorFocus"
            },
            {
                key: "cmd+a cmd+s",
                command: "editor.action.inlineDiffs.acceptAll",
                when: "editorTextFocus && (arbitrary function)"
            },
            {
                key: "cmd+enter",
                command: "-editor.action.inlineDiffs.acceptAll",
                when: "editorTextFocus && (arbitrary function)"
            }
        ];
    }
    else {
        newKeybindings = [
            {
                command: "gait-copilot.startInlineChat",
                key: "cmd+i",
                when: "editorFocus && inlineChatHasProvider && !editorReadonly"
            }
        ];
    }
    newKeybindings = [...newKeybindings, ...sharedKeybindings];

    const extensionPackageJsonPath = path.resolve(context.extensionPath, 'package.json');
    console.log("extensionPackageJsonPath", extensionPackageJsonPath);
    const extensionPackageJson = fs.readFileSync(extensionPackageJsonPath, 'utf8');
    const extensionPackageJsonObj = JSON.parse(extensionPackageJson);
    if (!areKeybindingsEqual(extensionPackageJsonObj.contributes.keybindings, newKeybindings)) {
        extensionPackageJsonObj.contributes.keybindings = newKeybindings;
        fs.writeFileSync(
            extensionPackageJsonPath,
            JSON.stringify(extensionPackageJsonObj, null, 4),
            'utf8',
        );
        vscode.window.showInformationMessage("Keybindings updated... Reloading");
        vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
}
function areKeybindingsEqual(keybindings: any, newKeybindings: Keybinding[]) {
    return keybindings.length === newKeybindings.length && keybindings.every((kb: Keybinding) => newKeybindings.some((newKb: Keybinding) => newKb.command === kb.command && newKb.key === kb.key));
}

