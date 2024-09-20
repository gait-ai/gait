import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as VSCodeReader from './vscode/vscodeReader';

const GAIT_FOLDER_NAME = '.gait';
const SCHEMA_VERSION = '1.0';
import { StashedState, PanelChat, MessageEntry, Context, LastAppended, isStashedState } from './types';

/**
 * Reads the stashed panel chats and last appended data from .gait/stashedPanelChats.json.
 * Accounts for cases where the file is empty or contains malformed JSON.
 */
export function readStashedPanelChats(gaitDir: string): StashedState {
  const stashedPath = path.join(gaitDir, 'stashedPanelChats.json');
  try {
    if (!fs.existsSync(stashedPath)) {
      // Initialize with empty stashedState and lastAppended
      const initialState: StashedState = { 
        panelChats: [], 
        schemaVersion: SCHEMA_VERSION,
        lastAppended: { order: [], lastAppendedMap: {} }
      };
      fs.writeFileSync(stashedPath, JSON.stringify(initialState, null, 2), 'utf-8');
      console.log(`stashedPanelChats.json not found. Initialized with empty stashedState and lastAppended.`);
      return initialState;
    }

    const stats = fs.statSync(stashedPath);
    if (stats.size === 0) {
      // File is empty, initialize it
      const initialState: StashedState = { 
        panelChats: [], 
        schemaVersion: SCHEMA_VERSION,
        lastAppended: { order: [], lastAppendedMap: {} }
      };
      fs.writeFileSync(stashedPath, JSON.stringify(initialState, null, 2), 'utf-8');
      console.log(`stashedPanelChats.json is empty. Initialized with empty stashedState and lastAppended.`);
      return initialState;
    }

    const content = fs.readFileSync(stashedPath, 'utf-8').trim();

    if (content === '') {
      // Content is empty string after trimming, initialize it
      const initialState: StashedState = { 
        panelChats: [], 
        schemaVersion: SCHEMA_VERSION,
        lastAppended: { order: [], lastAppendedMap: {} }
      };
      fs.writeFileSync(stashedPath, JSON.stringify(initialState, null, 2), 'utf-8');
      console.log(`stashedPanelChats.json contains only whitespace. Initialized with empty stashedState and lastAppended.`);
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
        lastAppended: { order: [], lastAppendedMap: {} }
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

    if (!parsed.lastAppended || typeof parsed.lastAppended !== 'object') {
      parsed.lastAppended = { order: [], lastAppendedMap: {} };
      isModified = true;
      console.warn(`lastAppended property missing or invalid. Initialized to default.`);
    } else {
      // Further ensure that lastAppended has 'order' and 'lastAppendedMap'
      if (!Array.isArray(parsed.lastAppended.order)) {
        parsed.lastAppended.order = [];
        isModified = true;
        console.warn(`lastAppended.order missing or not an array. Initialized as empty array.`);
      }

      if (typeof parsed.lastAppended.lastAppendedMap !== 'object') {
        parsed.lastAppended.lastAppendedMap = {};
        isModified = true;
        console.warn(`lastAppended.lastAppendedMap missing or not an object. Initialized as empty object.`);
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
      lastAppended: { order: [], lastAppendedMap: {} }
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

/**
 * Monitors the panel chat and appends new chats to stashedPanelChats.json.
 */
let isAppending = false;

export async function monitorPanelChatAsync(context: vscode.ExtensionContext) {
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
      const lastAppended = existingStashedState.lastAppended; // Access lastAppended
      const existingIds = lastAppended.order;

      // Parse the current panelChats with existing UUIDs
      const parsedStashedState = await VSCodeReader.parsePanelChatAsync(context, existingIds);
      const panelChats = parsedStashedState.panelChats;

      // Read the existing stashedPanelChats.json as existingStashedState

      // Initialize a new order array
      const newOrder: string[] = [];

      for (const panelChat of panelChats) {
        const panelChatId = panelChat.id;
        newOrder.push(panelChatId);

        // Find if this panelChat already exists in existingStashedState
        const existingPanelChatIndex = existingStashedState.panelChats.findIndex(pc => pc.id === panelChatId);

        if (existingPanelChatIndex !== -1) {
          // PanelChat exists, append new messages
          const lastAppendedIndex = lastAppended.lastAppendedMap[panelChatId] || 0;
          const totalMessages = panelChat.messages.length;

          // Determine new messages to append
          const newMessages = panelChat.messages.slice(lastAppendedIndex);
          //console.log(`monitorPanelChatAsync: New messages for panelChat ${panelChatId}: ${newMessages.length}`);

          if (newMessages.length > 0) {
            existingStashedState.panelChats[existingPanelChatIndex].messages.push(...newMessages);
            //console.log(`monitorPanelChatAsync: Appended ${newMessages.length} messages to existing PanelChat ${panelChatId}.`);

            // Update the last appended index for this panelChat
            lastAppended.lastAppendedMap[panelChatId] = (lastAppended.lastAppendedMap[panelChatId] || 0) + newMessages.length;
          }
        } else {
          // PanelChat does not exist, add it to panelChats
          existingStashedState.panelChats.push(panelChat);
          console.log(`monitorPanelChatAsync: Added new PanelChat ${panelChatId} with ${panelChat.messages.length} messages.`);

          // Initialize the last appended index for this new panelChat
          lastAppended.lastAppendedMap[panelChatId] = panelChat.messages.length;
        }
      }

      // Update the order in lastAppended
      lastAppended.order = newOrder;

      // Write back to stashedPanelChats.json
      await writeStashedPanelChats(gaitDir, existingStashedState);
    } catch (error) {
      console.error(`Error monitoring and saving state:`, error);
      vscode.window.showErrorMessage(`Error monitoring and saving state: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      isAppending = false;
    }
  }, 1000);
}




