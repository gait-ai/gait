import { PanelChat, Context } from './types';
import { CommitData } from './panelgit';
import * as fs from 'fs';
import * as vscode from 'vscode';

function contextToText(context: Context, seenFilenames: Set<string> = new Set<string>()): string{
    function readFileOrSeen(uri: string, seenFilenames: Set<string>): string{
        if (seenFilenames.has(uri)) {
            return "File already written above.";
        }
        seenFilenames.add(uri);
        const fileContent = fs.readFileSync(uri, 'utf8');
        return fileContent;
    }
    try {
        const {context_type, value} = context; 
        if (context_type === "selection"){
            const {uri, text} = value;
            if (text) {
                return `Selection from ${uri} with text content:\n ${text}`;
            } else {
                const fileContent = readFileOrSeen(uri, seenFilenames);
                return `Selection from ${uri} - whole text of file: \n ${fileContent}`;
            }
        } 
        if (context_type === "file"){
            const {uri} = value;
            const fileContent = readFileOrSeen(uri, seenFilenames);
            return `${uri}: wole file in context:\n\`\`\`\n${fileContent}\n\`\`\`\n`;
        } 
        if (context_type === "folder"){
            const {relativePath} = value;
            function readFolder(path: string): string{
                const dir = fs.opendirSync(path);
                let dirEl = dir.readSync();
                let out: string= "";
                while (dirEl){
                    if (dirEl?.isFile()) {
                        out += (`File content of ${dirEl.parentPath}: \n`+ readFileOrSeen(dirEl.parentPath, seenFilenames));
                    } if (dirEl.isDirectory()){
                        out += readFolder(dirEl.parentPath);
                    }
                    dirEl =  dir.readSync();
                }
                return out;
            }
            return `Folder relative path - ${relativePath}` + readFolder(relativePath);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Error reading context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return JSON.stringify(context);
}
/**
 * Converts a list of PanelChats and Git history data into a formatted markdown string.
 * @param panelChats - Array of PanelChat objects.
 * @param gitHistory - Git history data.
 * @returns A formatted markdown string.
 */
export function panelChatsToMarkdown(panelChats: ({commit: CommitData, panelChat: PanelChat})[], expand_context = false): string {
    //console.log("panelChats: ", panelChats);
    let markdown = `# Panel Chats\n\n`;
    // Create a Set to store seen filenames
    panelChats.forEach(panelChat => {
        markdown += "## Title: " + panelChat.panelChat.customTitle + "\n";
        if (panelChat.commit) {
            markdown += `- **Commit**: ${panelChat.commit.commitHash}\n`;
            markdown += `- **Commit Message**: ${panelChat.commit.commitMessage}\n`;
            markdown += `- **Author**: ${panelChat.commit.author}\n`;
            markdown += `- **Date**: ${panelChat.commit.date}\n`;
        }
        markdown += `- **Created On**: ${panelChat.panelChat.created_on}\n`;
        markdown += `- **Messages**:\n`;
        panelChat.panelChat.messages.forEach(message => {
            markdown += `    - **Model**: ${message.model}\n`;
            markdown += `    - **Context**: ${message.context.map((context) => context.value.human_readable)}\n`;
            markdown += `    - **Text**: ${message.messageText}\n`;
            markdown += `    - **Response**: ${message.responseText}\n`;
            if (expand_context) {
                markdown += ` - **Expanded Context** + ${message.context.map((context) => contextToText(context))}`;
            }
        });
        markdown += `\n`;
    });

    return markdown;
}
