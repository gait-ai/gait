// TODO: Given recent refactors this as a seperate file feels weird
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const GAIT_FOLDER_NAME = '.gait';
const SCHEMA_VERSION = '1.0';
import { PanelChat, PanelChatMode, StashedState, StateReader } from './types';
import { readStashedState, writeStashedState } from './stashedState';


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
 * Monitors the panel chat and appends new chats to stashedPanelChats.json.
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
    const panelChatMode = context.workspaceState.get('panelChatMode');
    isAppending = true;
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error('No workspace folder found');
      }

      const gaitDir = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
      // Ensure the .gait directory exists
      if (!fs.existsSync(gaitDir)) {
        fs.mkdirSync(gaitDir, { recursive: true });
        //console.log(`Created directory: ${gaitDir}`);
      }

      // Read the existing stashedPanelChats.json as existingStashedState
      let existingStashedState = readStashedState();
      let currentPanelChats = [];

      // Parse the current panelChats
      const incomingPanelChats = sanitizePanelChats(await stateReader.parsePanelChatAsync());
      let change = false;
      for (const incomingPanelChat of incomingPanelChats) {
        const panelChatId = incomingPanelChat.id;

        // Find if this PanelChat already exists in existingStashedState
        const existingPanelChat = existingStashedState.panelChats.find(pc => pc.id === panelChatId);
        if (existingPanelChat) {
          // PanelChat exists, append only new messages whose IDs don't already exist
          const existingMessageIds = new Set(existingPanelChat.messages.map(msg => msg.id));
          const newMessages = incomingPanelChat.messages.filter(msg => !existingMessageIds.has(msg.id));

          if (newMessages.length > 0) {
            existingPanelChat.messages.push(...newMessages);
            change = true;
            //console.log(`monitorPanelChatAsync: Appended ${newMessages.length} new messages to existing PanelChat ${panelChatId}.`);
          }
        } else {
          // PanelChat does not exist, add it to panelChats
          if (panelChatMode === 'AddAllChats') {
            existingStashedState.panelChats.push(incomingPanelChat);
            change = true;
            //console.log(`monitorPanelChatAsync: Added new PanelChat ${panelChatId} with ${incomingPanelChat.messages.length} messages.`);
          } 
          currentPanelChats.push(incomingPanelChat);
        }
      }
      context.workspaceState.update('currentPanelChats', currentPanelChats);

      // Write back to stashedPanelChats.json
      if (change) {
        await writeStashedState(existingStashedState);
      }
    } catch (error) {
      console.error(`Error monitoring and saving state:`, error);
      vscode.window.showErrorMessage(`Error monitoring and saving state: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      isAppending = false;
    }
  }, 1000); // Runs every second
}


/**
 * Associates a file with a message in the stashed panel chats.
 * @param messageId The ID of the message to associate with the file.
 * @param filePath The path of the file to associate.
 */
export async function associateFileWithMessage(messageId: string, filePath: string, newPanelChat: PanelChat): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }

    const gaitDir = path.join(workspaceFolder.uri.fsPath, GAIT_FOLDER_NAME);
    let stashedState = readStashedState();

    let messageFound = false;
    for (const panelChat of stashedState.panelChats) {
        for (const message of panelChat.messages) {
            if (message.id === messageId) {
                message.kv_store = { 
                    ...message.kv_store, 
                    file_paths: [...(message.kv_store?.file_paths || []), filePath]
                };
                messageFound = true;
                break;
            }
        }
        if (messageFound) {
            break;
        }
    }

    if (!messageFound) {
        vscode.window.showInformationMessage(`Adding associated panel chat to stashed state`);
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
        stashedState.panelChats.push(newPanelChat);
        await writeStashedState(stashedState);
        return;
    }
    vscode.window.showInformationMessage(`Associated file with message: ${messageId}`);

    await writeStashedState(stashedState);
}

