import { PanelChat } from './types';
import { GitHistoryData } from './panelview';

/**
 * Converts a list of PanelChats and Git history data into a formatted markdown string.
 * @param panelChats - Array of PanelChat objects.
 * @param gitHistory - Git history data.
 * @returns A formatted markdown string.
 */
export function panelChatsToMarkdown(panelChats: PanelChat[], gitHistory: GitHistoryData): string {
    let markdown = `# Panel Chats and Git History\n\n`;

    markdown += `## Git History\n`;
    gitHistory.commits.forEach(commit => {
        markdown += `- **Commit**: ${commit.commitHash}\n`;
        markdown += `  - **Date**: ${commit.date.toISOString()}\n`;
        markdown += `  - **Message**: ${commit.commitMessage}\n`;
        markdown += `  - **Author**: ${commit.author}\n\n`;
    });

    markdown += `## Panel Chats\n`;
    panelChats.forEach(chat => {
        markdown += `### Chat ID: ${chat.id}\n`;
        markdown += `- **AI Editor**: ${chat.ai_editor}\n`;
        markdown += `- **Custom Title**: ${chat.customTitle}\n`;
        markdown += `- **Parent ID**: ${chat.parent_id}\n`;
        markdown += `- **Created On**: ${chat.created_on}\n`;
        markdown += `- **Messages**:\n`;
        chat.messages.forEach(message => {
            markdown += `  - **Message ID**: ${message.id}\n`;
            markdown += `    - **Text**: ${message.messageText}\n`;
            markdown += `    - **Response**: ${message.responseText}\n`;
            markdown += `    - **Model**: ${message.model}\n`;
            markdown += `    - **Timestamp**: ${message.timestamp}\n\n`;
        });
    });

    return markdown;
}
