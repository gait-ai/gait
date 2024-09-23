// yourFile.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const GAIT_FOLDER_NAME = '.gait';
const SCHEMA_VERSION = '1.0';
import { PanelChat, StashedState, StateReader } from './types';

/**
 * Reads the stashed panel chats and deleted chats from .gait/stashedPanelChats.json.
 * Accounts for cases where the file is empty or contains malformed JSON.
 */
export function readStashedPanelChats(gaitDir: string): StashedState {
  const stashedPath = path.join(gaitDir, 'stashedPanelChats.json');
  const initialState: StashedState = { 
    panelChats: [], 
    schemaVersion: SCHEMA_VERSION,
    deletedChats: { deletedMessageIDs: [], deletedPanelChatIDs: [] },
    kv_store: {}
  };
  try {
    if (!fs.existsSync(stashedPath)) {
      // Initialize with empty stashedState and deletedChats
      fs.writeFileSync(stashedPath, JSON.stringify(initialState, null, 2), 'utf-8');
      console.log(`stashedPanelChats.json not found. Initialized with empty stashedState and deletedChats.`);
      return initialState;
    }

    const stats = fs.statSync(stashedPath);
    if (stats.size === 0) {
      fs.writeFileSync(stashedPath, JSON.stringify(initialState, null, 2), 'utf-8');
      console.log(`stashedPanelChats.json is empty. Initialized with empty stashedState and deletedChats.`);
      return initialState;
    }

    const content = fs.readFileSync(stashedPath, 'utf-8').trim();

    if (content === '') {
      fs.writeFileSync(stashedPath, JSON.stringify(initialState, null, 2), 'utf-8');
      console.log(`stashedPanelChats.json contains only whitespace. Initialized with empty stashedState and deletedChats.`);
      return initialState;
    }

    let parsed: StashedState;

    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error(`Error parsing stashedPanelChats.json:`, parseError);
      vscode.window.showErrorMessage(`stashedPanelChats.json is malformed. Reinitializing the file.`);
      
      // Reinitialize the file with default state
      const initialState: StashedState = { 
        panelChats: [], 
        schemaVersion: SCHEMA_VERSION,
        deletedChats: { deletedMessageIDs: [], deletedPanelChatIDs: [] },
        kv_store: {}
      };
      fs.writeFileSync(stashedPath, JSON.stringify(initialState, null, 2), 'utf-8');
      return initialState;
    }

    // Ensure that all required properties are present
    let isModified = false;

    if (!Array.isArray(parsed.panelChats)) {
      parsed.panelChats = [];
      isModified = true;
      console.warn(`panelChats property missing or not an array. Initialized as empty array.`);
    }

    if (typeof parsed.schemaVersion !== 'string') {
      parsed.schemaVersion = SCHEMA_VERSION;
      isModified = true;
      console.warn(`schemaVersion property missing or not a string. Initialized to default schema version.`);
    }

    if (!parsed.deletedChats || typeof parsed.deletedChats !== 'object') {
      parsed.deletedChats = { deletedMessageIDs: [], deletedPanelChatIDs: [] };
      isModified = true;
      console.warn(`deletedChats property missing or invalid. Initialized to default.`);
    } else {
      // Further ensure that deletedChats has 'deletedMessageIDs' and 'deletedPanelChatIDs'
      if (!Array.isArray(parsed.deletedChats.deletedMessageIDs)) {
        parsed.deletedChats.deletedMessageIDs = [];
        isModified = true;
        console.warn(`deletedChats.deletedMessageIDs missing or not an array. Initialized as empty array.`);
      }

      if (!Array.isArray(parsed.deletedChats.deletedPanelChatIDs)) {
        parsed.deletedChats.deletedPanelChatIDs = [];
        isModified = true;
        console.warn(`deletedChats.deletedPanelChatIDs missing or not an array. Initialized as empty array.`);
      }
    }

    if (isModified) {
      // Write the corrected state back to the file
      fs.writeFileSync(stashedPath, JSON.stringify(parsed, null, 2), 'utf-8');
      console.log(`stashedPanelChats.json was missing some properties. Updated with default values.`);
    }

    //console.log(`Read stashedState from stashedPanelChats.json:`, parsed);
    return parsed;
  } catch (error) {
    console.error(`Error reading stashedPanelChats.json:`, error);
    vscode.window.showErrorMessage(`Error reading stashedPanelChats.json: ${error instanceof Error ? error.message : 'Unknown error'}`);
    // Return an empty state to prevent application crash
    return { 
      panelChats: [], 
      schemaVersion: SCHEMA_VERSION,
      deletedChats: { deletedMessageIDs: [], deletedPanelChatIDs: [] },
      kv_store: {}
    };
  }
}

async function writeStashedPanelChats(gaitDir: string, stashedState: StashedState): Promise<void> {
  const stashedPath = path.join(gaitDir, 'stashedPanelChats.json');
  try {
    fs.writeFileSync(stashedPath, JSON.stringify(stashedState, null, 2), 'utf-8');
    console.log(`Updated stashedPanelChats.json with stashedState.`);
  } catch (error) {
    console.error(`Error writing to stashedPanelChats.json:`, error);
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

export async function monitorPanelChatAsync(stateReader: StateReader) {
  setInterval(async () => {
    if (isAppending) {
      // Skip if a previous append operation is still in progress
      return;
    }
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
          existingStashedState.panelChats.push(incomingPanelChat);
          console.log(`monitorPanelChatAsync: Added new PanelChat ${panelChatId} with ${incomingPanelChat.messages.length} messages.`);
        }
      }

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
