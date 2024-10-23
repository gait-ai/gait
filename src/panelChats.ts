// TODO: Given recent refactors this as a seperate file feels weird
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceFolder } from './utils';

const GAIT_FOLDER_NAME = '.gait';
const SCHEMA_VERSION = '1.0';

import { MessageEntry, PanelChat, PanelChatMode, StashedState, StateReader } from './types';
import { readStashedState, readStashedStateFromFile, writeChatToStashedState } from './stashedState';
import posthog from 'posthog-js';



function sanitizePanelChats(panelChats: PanelChat[]): PanelChat[] {
  // Regular expression to match the unwanted command strings
  const commandRegex = /\(command:_github\.copilot\.[^)]*\)/g;

  // Deep clone the stashedState to avoid mutating the original object
  const panelChats2: PanelChat[] = JSON.parse(JSON.stringify(panelChats));

  // Iterate through each PanelChat
  panelChats2.forEach((panelChat) => {
    // Iterate through each MessageEntry within the PanelChat
    panelChat.messages.forEach((message) => {
      // Remove the unwanted command strings from messageText
      if (typeof message.messageText === 'string') {
        message.messageText = message.messageText.replace(commandRegex, '').trim();
      }

      // Remove the unwanted command strings from responseText
      if (typeof message.responseText === 'string') {
        message.responseText = message.responseText.replace(commandRegex, '').trim();
      }
    });
  });

  return panelChats2;
}

/**
 * Monitors the panel chat and appends new chats to state.json.
 * Note: Since 'lastAppended' has been removed from StashedState, this function has been simplified.
 * You may need to implement a new mechanism for tracking appended messages.
 */
let isAppending = false;

export async function monitorPanelChatAsync(stateReader: StateReader, context: vscode.ExtensionContext) {
  setInterval(async () => {
    if (isAppending) {
      // Skip if a previous append operation is still in progress
      return;
    }
    const oldPanelChats: PanelChat[] | undefined = context.workspaceState.get('currentPanelChats');
    isAppending = true;
    try {
      const workspaceFolder = getWorkspaceFolder();
      const gaitDir = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
      // Ensure the .gait directory exists
      if (!fs.existsSync(gaitDir)) {
        fs.mkdirSync(gaitDir, { recursive: true });
        //console.log(`Created directory: ${gaitDir}`);
      }

      // Parse the current panelChats
      const incomingPanelChats = sanitizePanelChats(await stateReader.parsePanelChatAsync());
      // Check for new panel chats or messages
      context.workspaceState.update('panelChatMessageNum', incomingPanelChats.reduce((acc, chat) => acc + chat.messages.length, 0));
      context.workspaceState.update('currentPanelChats', incomingPanelChats);
      const stashedState = readStashedStateFromFile();
      context.workspaceState.update('stashedState', stashedState);

    } catch (error) {
      console.error(`Error monitoring and saving state:`, error);
      vscode.window.showErrorMessage(`Error monitoring and saving state: ${error instanceof Error ? error.message : 'Unknown error'}`);
      posthog.capture('error_monitoring_and_saving_state', { error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      isAppending = false;
    }
  }, 4000); // Runs every 4 seconds
}


/**
 * Associates a file with a message in the stashed panel chats.
 * @param messageId The ID of the message to associate with the file.
 * @param filePath The path of the file to associate.
 */

export async function associateFileWithMessageCodeblock(context: vscode.ExtensionContext, message: MessageEntry, filePath: string, newPanelChat: PanelChat, index_of_code_block: number): Promise<void> {
    try {
        const workspaceFolder = getWorkspaceFolder();
        const messageId = message.id;
        let stashedState = readStashedState(context);

        let messageFound = false;
        for (const panelChat of stashedState.panelChats) {
            for (const message of panelChat.messages) {
                if (message.id === messageId) {
                    message.kv_store = { 
                        ...message.kv_store, 
                        file_path_dict: {
                          ...message.kv_store?.file_path_dict,
                          [index_of_code_block]: filePath
                        }
                    };
                    if (!((message.kv_store?.file_paths || []).includes(filePath))) {
                      message.kv_store = {
                        ...message.kv_store,
                        file_paths: [...(message.kv_store?.file_paths || []), filePath]
                        }
                    }
                    messageFound = true;
                    break;
                }
            }
            if (messageFound) {
                break;
            }
        }

        if (!messageFound) {
            let truncatedMessage = message.messageText.substring(0, 50);
            if (message.messageText.length > 50) {
                truncatedMessage += '...';
            }
            // Find the message in newPanelChat with the matching messageId
            const targetMessage = newPanelChat.messages.find(message => message.id === messageId);
            if (targetMessage) {
                // Set the kv_store with the file_paths including the new filePath
                targetMessage.kv_store = {
                    ...targetMessage.kv_store,
                    file_paths: [...(targetMessage.kv_store?.file_paths || []), filePath]
                };
            } else {
              throw new Error(`Message with ID ${messageId} not found in the new panel chat.`);
            }
            writeChatToStashedState(context, newPanelChat);
            return;
        }
        vscode.window.showInformationMessage(`Associated file with message: ${messageId}`);

        writeChatToStashedState(context, newPanelChat);
    } catch (error) {
        console.error('Error associating file with message:', error);
        vscode.window.showErrorMessage(`Error associating file with message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}


