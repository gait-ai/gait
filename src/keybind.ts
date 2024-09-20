import fs from 'fs/promises';
import path from 'path';

import { parse } from 'jsonc-parser';
import vscode from 'vscode';

interface Keybinding {
    key: string;
    command: string;
    when?: string;
}

async function generateKeybindings(extensionPath: string) {
    await vscode.commands.executeCommand('workbench.action.openDefaultKeybindingsFile');

    const keybindings = parse(vscode.window.activeTextEditor!.document.getText()) as Keybinding[];
    const cmdRKeybindings = keybindings.filter((kb) => kb.key.startsWith('cmd+r '));

    // cursor use cmd + r as prefix, we restore to use cmd + k
    const removedCmdRShortcuts = cmdRKeybindings.map((kb) => {
        return {
            ...kb,
            command: `-${kb.command}`,
        };
    });

    // replace cmd + r with cmd + k
    const cmdKKeybindings = cmdRKeybindings.map((kb) => {
        return {
            ...kb,
            key: kb.key.replace('cmd+r', 'cmd+k'),
        };
    });

    // cmd + k used as shortcut prefix, remove all 'cmd+k' shortcuts
    const removedCmdKKeybindings = keybindings
        .filter((kb) => kb.key === 'cmd+k')
        .map((kb) => {
            return {
                ...kb,
                command: `-${kb.command}`,
            };
        });

    // replace `cmd+k` to `cmd+e`
    const cmdEKeybindings = removedCmdKKeybindings
        .filter((kb) => !kb.command.startsWith('-workbench.'))
        .map((kb) => {
            return {
                ...kb,
                key: kb.key.replace('cmd+k', 'cmd+e'),
                command: kb.command.slice(1),
            };
        });

    // extra often used shortcuts in vscode to remove
    const shortcutsToRemoved: Keybinding[] = [
        {
            key: 'shift+cmd+k',
            command: '-aipopup.action.modal.generate',
            when: 'editorFocus && !composerBarIsVisible && !composerControlPanelIsVisible',
        },
        {
            key: 'cmd+l',
            command: '-aichat.newchataction',
        },
        {
            key: 'shift+cmd+l',
            command: '-aichat.insertselectionintochat',
        },
    ];

    const additionalShortcuts = [
        {
            key: 'cmd+]',
            command: 'aichat.newchataction',
        },
        {
            key: 'shift+cmd+]',
            command: 'aichat.insertselectionintochat',
        },

        // cursor missing this shortcut
        {
            key: 'cmd+l',
            command: 'expandLineSelection',
            when: 'textInputFocus',
        },

        // clear terminal
        {
            ...keybindings.find((kb) => kb.command === 'workbench.action.terminal.clear'),
            key: 'shift+cmd+k',
        },
    ];

    const keyChordLeader = [
        {
            key: 'cmd+r',
            command: '-workbench.action.keychord.leader',
            when: 'false',
        },
        {
            key: 'cmd+k',
            command: 'workbench.action.keychord.leader',
            when: 'false',
        },
    ];

    const newKeybindings: Keybinding[] = [
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

    const resultShortcuts = [
        ...newKeybindings,
        ...removedCmdRShortcuts,
        ...cmdKKeybindings,
        ...removedCmdKKeybindings,
        ...cmdEKeybindings,
        ...shortcutsToRemoved,
        ...additionalShortcuts,
        ...keyChordLeader,
    ];

    const extensionPackageJsonPath = path.resolve(extensionPath, 'package.json');
    const extensionPackageJson = await fs.readFile(extensionPackageJsonPath, 'utf8');
    const extensionPackageJsonObj = JSON.parse(extensionPackageJson);
    extensionPackageJsonObj.contributes.keybindings = resultShortcuts;
    await fs.writeFile(
        extensionPackageJsonPath,
        JSON.stringify(extensionPackageJsonObj, null, 4),
        'utf8',
    );
}
