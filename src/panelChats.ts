import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const LAST_APPENDED_FILE = 'lastAppended.json'; // Changed to JSON format
const GAIT_FOLDER_NAME = '.gait';
const SCHEMA_VERSION = '1.0';

import { v4 as uuidv4 } from 'uuid';
import { readVSCodeState } from './extension';
import { StashedState, PanelChat, MessageEntry, Context, LastAppended, isStashedState } from './types';
/**
 * Parses the panel chat from interactive sessions and assigns UUIDs based on existing order.
 */
async function parsePanelChatAsync(
  context: vscode.ExtensionContext,
  existingIds: string[]
): Promise<StashedState> {
  try {
    const interactiveSessions = await readVSCodeState(context, 'interactive.sessions');

    if (!Array.isArray(interactiveSessions)) {
      vscode.window.showErrorMessage('Interactive sessions data is not an array.');
      return { panelChats: [], schemaVersion: SCHEMA_VERSION };
    }

    const panelChats: PanelChat[] = interactiveSessions.map((panel: any, index: number) => {
      const ai_editor: string = "copilot";

      // Determine if this PanelChat has an existing UUID
      let id: string;
      const existingIndex = index - (interactiveSessions.length - existingIds.length);
      if (existingIndex >= 0 && existingIndex < existingIds.length) {
        // Assign existing UUID
        id = existingIds[existingIndex];
      } else {
        // Assign new UUID
        id = uuidv4();
      }

      const parent_id: string | null = null;
      const created_on: string = typeof panel.creationDate === 'string' ? panel.creationDate : new Date().toISOString();

      // Extract messages
      console.log(`Parsing panel chat with ${panel.requests.length} sessions.`);
      console.log(panel);

      const messages: MessageEntry[] = panel.requests.map((request: any) => {
        // Safely extract messageText
        const messageText: string = typeof request.message?.text === 'string' ? request.message.text : '';

        // Safely extract responseText
        let responseText: string = '';

        if (Array.isArray(request.response)) {
          // Concatenate all response values into a single string, separated by newlines
          const validResponses = request.response
            .map((response: any) => response.value)
            .filter((value: any) => typeof value === 'string' && value.trim() !== '');

          responseText = validResponses.join('\n');
        } else if (typeof request.response?.value === 'string') {
          responseText = request.response.value;
        }

        // Extract model and timestamp if available
        const model: string = typeof request.model === 'string' ? request.model : 'Unknown';
        const timestamp: string = typeof request.timestamp === 'string' ? request.timestamp : new Date().toISOString();

        // Extract context if available
        let contextData: Context[]  = [];
        if (Array.isArray(request.context)) {
          contextData = request.context
            .map((ctx: any) => {
              if (typeof ctx.type === 'string' && typeof ctx.value === 'string') {
                switch (ctx.type) {
                  case 'RelativePath':
                  case 'SymbolFromReferences':
                  case 'SymbolInFile':
                    return { context_type: ctx.type, key: ctx.key, value: ctx.value } as Context;
                  default:
                    return undefined;
                }
              }
              return undefined;
            })
            .filter((ctx: Context | undefined) => ctx !== undefined) as Context[];
        }

        console.log(`Parsed message: ${messageText} -> ${responseText}`);
        return {
          id: uuidv4(), // Assign new UUID to MessageEntry
          messageText,
          responseText,
          model,
          timestamp,
          context: contextData,
        };
      }).filter((entry: MessageEntry) =>
        entry.messageText.trim() !== '' && entry.responseText.trim() !== ''
      );

      console.log(`Parsed panel chat with ${messages.length} messages.`);
      return {
        ai_editor,
        id,
        parent_id,
        created_on,
        messages,
      } as PanelChat;
    });

    return { panelChats, schemaVersion: SCHEMA_VERSION };
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to parse panel chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { panelChats: [], schemaVersion: SCHEMA_VERSION };
  }
}

/**
 * Reads the last appended indices and order from .gait/lastAppended.json.
 */
async function readLastAppended(gaitDir: string): Promise<LastAppended> {
  const lastAppendedPath = path.join(gaitDir, LAST_APPENDED_FILE);
  try {
    if (!fs.existsSync(lastAppendedPath)) {
      // Initialize the file with empty order and map if it doesn't exist
      const initial: LastAppended = { order: [], lastAppendedMap: {} };
      fs.writeFileSync(lastAppendedPath, JSON.stringify(initial, null, 2), 'utf-8');
      console.log(`${LAST_APPENDED_FILE} not found. Initialized with empty order and map.`);
      return initial;
    }
    const content = fs.readFileSync(lastAppendedPath, 'utf-8');
    const parsed: LastAppended = JSON.parse(content);
    console.log(`Read LastAppended from ${LAST_APPENDED_FILE}:`, parsed);
    return parsed;
  } catch (error) {
    console.error(`Error reading ${LAST_APPENDED_FILE}:`, error);
    return { order: [], lastAppendedMap: {} };
  }
}

async function writeLastAppended(gaitDir: string, lastAppended: LastAppended): Promise<void> {
  const lastAppendedPath = path.join(gaitDir, LAST_APPENDED_FILE);
  try {
    fs.writeFileSync(lastAppendedPath, JSON.stringify(lastAppended, null, 2), 'utf-8');
    console.log(`Updated ${LAST_APPENDED_FILE} with:`, lastAppended);
  } catch (error) {
    console.error(`Error writing to ${LAST_APPENDED_FILE}:`, error);
    throw error;
  }
}

/**
 * Reads the stashed panel chats from .gait/stashedPanelChats.json.
 */
async function readStashedPanelChats(gaitDir: string): Promise<StashedState> {
  const stashedPath = path.join(gaitDir, 'stashedPanelChats.json');
  try {
    if (!fs.existsSync(stashedPath)) {
      // Initialize with empty stashedState
      const initialState: StashedState = { panelChats: [], schemaVersion: SCHEMA_VERSION };
      fs.writeFileSync(stashedPath, JSON.stringify(initialState, null, 2), 'utf-8');
      console.log(`stashedPanelChats.json not found. Initialized with empty stashedState.`);
      return initialState;
    }
    const content = fs.readFileSync(stashedPath, 'utf-8');
    const parsed: StashedState = JSON.parse(content);
    console.log(`Read stashedState from stashedPanelChats.json:`, parsed);
    return parsed;
  } catch (error) {
    console.error(`Error reading stashedPanelChats.json:`, error);
    vscode.window.showErrorMessage(`Error reading stashedPanelChats.json: ${error instanceof Error ? error.message : 'Unknown error'}`);
    // Return an empty state to prevent application crash
    return { panelChats: [], schemaVersion: SCHEMA_VERSION };
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

      // Read the last appended data
      const lastAppended = await readLastAppended(gaitDir);
      const existingIds = lastAppended.order;

      // Parse the current panelChats with existing UUIDs
      const stashedState = await parsePanelChatAsync(context, existingIds);
      const panelChats = stashedState.panelChats;

      // Read the existing stashedPanelChats.json as existingStashedState
      let existingStashedState = await readStashedPanelChats(gaitDir);

      // Initialize a new order array
      const newOrder: string[] = [];

      // Iterate through each panelChat in order
      for (const panelChat of panelChats) {
        const panelChatId = panelChat.id;
        newOrder.push(panelChatId);

        // Find if this panelChat already exists in existingStashedState
        console.log("test1: ", existingStashedState)
        console.log("test: ", existingStashedState.panelChats)
        const existingPanelChatIndex = existingStashedState.panelChats.findIndex(pc => pc.id === panelChatId);

        if (existingPanelChatIndex !== -1) {
          // PanelChat exists, append new messages
          const lastAppendedIndex = lastAppended.lastAppendedMap[panelChatId] || 0;
          const totalMessages = panelChat.messages.length;

          // Determine new messages to append
          const newMessages = panelChat.messages.slice(lastAppendedIndex);
          console.log(`monitorPanelChatAsync: New messages for panelChat ${panelChatId}: ${newMessages.length}`);

          if (newMessages.length > 0) {
            existingStashedState.panelChats[existingPanelChatIndex].messages.push(...newMessages);
            console.log(`monitorPanelChatAsync: Appended ${newMessages.length} messages to existing PanelChat ${panelChatId}.`);

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

      // Write the updated last appended data
      await writeLastAppended(gaitDir, lastAppended);
    } catch (error) {
      console.error(`Error monitoring and saving state:`, error);
      vscode.window.showErrorMessage(`Error monitoring and saving state: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      isAppending = false;
    }
  }, 1000);
}
