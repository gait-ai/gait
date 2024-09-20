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
    if (tool === "Cursor") {
        newKeybindings = [{
                "key": "cmd+e",
                "command": "aipopup.action.modal.generate",
                "when": "editorFocus && !composerBarIsVisible && !composerControlPanelIsVisible"
            },
            {
                "key": "cmd+k",
                "command": "-aipopup.action.modal.generate",
                "when": "editorFocus && !composerBarIsVisible && !composerControlPanelIsVisible"
            },
            {
                "key": "cmd+e",
                "command": "composer.startComposerPrompt",
                "when": "composerIsEnabled"
            },
            {
                "key": "cmd+k",
                "command": "-composer.startComposerPrompt",
                "when": "composerIsEnabled"
            },
            {
                command: "gait-copilot.startInlineChat",
                key: "cmd+k",
                when: "editorFocus"
            },
            {
                command: "gait-copilot.acceptInlineChat",
                key: "cmd+enter",
                when: "editorTextFocus"
            }
        ];
    }
    else {
        newKeybindings = [
            {
                command: "gait-copilot.startInlineChat",
                key: "cmd+i",
                when: "editorFocus && inlineChatHasProvider && !editorReadonly"
            },
            {
                command: "gait-copilot.acceptInlineChat",
                key: "cmd+enter",
                when: "inlineChatHasProvider && inlineChatVisible && !inlineChatDocumentChanged || inlineChatHasProvider && inlineChatVisible && config.inlineChat.mode != 'preview'"
            }
        ];
    }

    const extensionPackageJsonPath = path.resolve(context.extensionPath, 'package.json');
    console.log("extensionPackageJsonPath", extensionPackageJsonPath);
    const extensionPackageJson = fs.readFileSync(extensionPackageJsonPath, 'utf8');
    const extensionPackageJsonObj = JSON.parse(extensionPackageJson);
    extensionPackageJsonObj.contributes.keybindings = newKeybindings;
    fs.writeFileSync(
        extensionPackageJsonPath,
        JSON.stringify(extensionPackageJsonObj, null, 4),
        'utf8',
    );
}
