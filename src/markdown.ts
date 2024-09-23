import { PanelChat } from './types';
import { CommitData } from './panelgit';

/**
 * Converts a list of PanelChats and Git history data into a formatted markdown string.
 * @param panelChats - Array of PanelChat objects.
 * @param gitHistory - Git history data.
 * @returns A formatted markdown string.
 */
export function panelChatsToMarkdown(panelChats: ({commit: CommitData, panelChat: PanelChat})[]): string {
    console.log("panelChats: ", panelChats);
    let markdown = `# Panel Chats and Git History\n\n`;

    panelChats.forEach(panelChat => {
        if (panelChat.commit) {
            markdown += `- **Commit**: ${panelChat.commit.commitHash}\n`;
            markdown += `- **Commit Message**: ${panelChat.commit.commitMessage}\n`;
            markdown += `- **Author**: ${panelChat.commit.author}\n`;
            markdown += `- **Date**: ${panelChat.commit.date}\n`;
        }
        markdown += `- **Chat Title**: ${panelChat.panelChat.customTitle}\n`;
        markdown += `- **Created On**: ${panelChat.panelChat.created_on}\n`;
        markdown += `- **Messages**:\n`;
        panelChat.panelChat.messages.forEach(message => {
            markdown += `  - **Message ID**: ${message.id}\n`;
            markdown += `    - **Text**: ${message.messageText}\n`;
            markdown += `    - **Response**: ${message.responseText}\n`;
            markdown += `    - **Context**: ${JSON.stringify(message.context)}\n`;
        });
        markdown += `\n`;
    });

    return markdown;
}
