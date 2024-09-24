// yourFile.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const GAIT_FOLDER_NAME = '.gait';
const SCHEMA_VERSION = '1.0';
import { PanelChat, PanelChatMode, StashedState, StateReader, readConsolidatedGaitData, writeConsolidatedGaitData } from './types';

/**
 * Reads the stashed panel chats and deleted chats from .gait/stashedPanelChats.json.
 * Accounts for cases where the file is empty or contains malformed JSON.
 */
export function readStashedPanelChats(gaitDir: string): StashedState {
  const gaitFilePath = path.join(gaitDir, 'consolidatedGaitData.json');
  const initialState: StashedState = { 
      panelChats: [], 
      schemaVersion: SCHEMA_VERSION,
      deletedChats: { deletedMessageIDs: [], deletedPanelChatIDs: [] },
      kv_store: {}
  };

  try {
      // Retrieve the consolidated gait data
      const consolidatedData = readConsolidatedGaitData(gaitDir);
      let stashedState = consolidatedData.stashedState;

      let isModified = false;

      // Validate stashedState presence
      if (!stashedState) {
          stashedState = initialState;
          isModified = true;
          console.warn(`stashedState missing in consolidatedGaitData.json. Initialized with default values.`);
      }

      // Validate panelChats
      if (!Array.isArray(stashedState.panelChats)) {
          stashedState.panelChats = [];
          isModified = true;
          console.warn(`panelChats property missing or not an array. Initialized as empty array.`);
      }

      // Validate schemaVersion
      if (typeof stashedState.schemaVersion !== 'string') {
          stashedState.schemaVersion = SCHEMA_VERSION;
          isModified = true;
          console.warn(`schemaVersion property missing or not a string. Initialized to default schema version.`);
      }

      // Validate deletedChats
      if (!stashedState.deletedChats || typeof stashedState.deletedChats !== 'object') {
          stashedState.deletedChats = { deletedMessageIDs: [], deletedPanelChatIDs: [] };
          isModified = true;
          console.warn(`deletedChats property missing or invalid. Initialized to default.`);
      } else {
          // Validate deletedMessageIDs
          if (!Array.isArray(stashedState.deletedChats.deletedMessageIDs)) {
              stashedState.deletedChats.deletedMessageIDs = [];
              isModified = true;
              console.warn(`deletedChats.deletedMessageIDs missing or not an array. Initialized as empty array.`);
          }

          // Validate deletedPanelChatIDs
          if (!Array.isArray(stashedState.deletedChats.deletedPanelChatIDs)) {
              stashedState.deletedChats.deletedPanelChatIDs = [];
              isModified = true;
              console.warn(`deletedChats.deletedPanelChatIDs missing or not an array. Initialized as empty array.`);
          }
      }

      // Validate kv_store
      if (!stashedState.kv_store || typeof stashedState.kv_store !== 'object') {
          stashedState.kv_store = {};
          isModified = true;
          console.warn(`kv_store property missing or invalid. Initialized to default.`);
      }

      // If any modifications were made, update the consolidatedGaitData.json file
      if (isModified) {
          consolidatedData.stashedState = stashedState;
          fs.writeFileSync(gaitFilePath, JSON.stringify(consolidatedData, null, 2), 'utf-8');
          console.log(`consolidatedGaitData.json was missing some stashedState properties. Updated with default values.`);
      }

      return stashedState;
  } catch (error) {
      console.error(`Error processing stashedPanelChats:`, error);
      vscode.window.showErrorMessage(`Error processing stashedPanelChats: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Return the initial state to prevent application crash
      return initialState;
  }
}

export async function writeStashedPanelChats(gaitDir: string, stashedState: StashedState): Promise<void> {
  try {
      // Retrieve the existing consolidated gait data
      const consolidatedData = readConsolidatedGaitData(gaitDir);

      // Update the stashedState with the new stashedState
      consolidatedData.stashedState = stashedState;

      // Persist the updated consolidated gait data
      await writeConsolidatedGaitData(gaitDir, consolidatedData);

      console.log(`Updated stashedState within consolidatedGaitData.json.`);
  } catch (error) {
      console.error(`Error updating stashedState in consolidatedGaitData.json:`, error);
      vscode.window.showErrorMessage(`Failed to update stashedState: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
  }
}


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
        console.log(`Created directory: ${gaitDir}`);
      }

      // Read the existing stashedPanelChats.json as existingStashedState
      let existingStashedState = readStashedPanelChats(gaitDir);
      let currentPanelChats = [];

      // Parse the current panelChats
      const incomingPanelChats = sanitizePanelChats(await stateReader.parsePanelChatAsync());

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
            console.log(`monitorPanelChatAsync: Appended ${newMessages.length} new messages to existing PanelChat ${panelChatId}.`);
          }
        } else {
          // PanelChat does not exist, add it to panelChats
          if (panelChatMode === 'AddAllChats') {
            existingStashedState.panelChats.push(incomingPanelChat);
            console.log(`monitorPanelChatAsync: Added new PanelChat ${panelChatId} with ${incomingPanelChat.messages.length} messages.`);
          } 
          currentPanelChats.push(incomingPanelChat);
        }
      }
      context.workspaceState.update('currentPanelChats', currentPanelChats);

      // Write back to stashedPanelChats.json
      await writeStashedPanelChats(gaitDir, existingStashedState);
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
    let stashedState = readStashedPanelChats(gaitDir);

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
        stashedState.panelChats.push(newPanelChat);
        await writeStashedPanelChats(gaitDir, stashedState);
        return;
    }
    vscode.window.showInformationMessage(`Associated file with message: ${messageId}`);

    await writeStashedPanelChats(gaitDir, stashedState);
}

