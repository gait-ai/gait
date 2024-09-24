import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { InlineStartInfo, FileChats } from './inline';

const SCHEMA_VERSION = '1.0';

export interface Context {
	context_type: string
	key: string
	value: any
}

function isContext(obj: any): obj is Context {
  return (
    typeof obj.context_type === 'string' &&
    typeof obj.key === 'string'
  );
}

export interface MessageEntry {
  id: string;
  messageText: string;
  responseText: string;
  model: string;
  timestamp: string;
  context: Context[];
  kv_store: { [key: string]: any };
}

export function isMessageEntry(obj: any): obj is MessageEntry {
  return (
    typeof obj.id === 'string' &&
    typeof obj.messageText === 'string' &&
    typeof obj.responseText === 'string' &&
    typeof obj.model === 'string' &&
    typeof obj.timestamp === 'string' &&
    Array.isArray(obj.context) && obj.context.every(isContext)
  );
}

export interface PanelChat {
  ai_editor: string;
  id: string;
  customTitle: string;
  parent_id: string | null;
  created_on: string;
  messages: MessageEntry[];
  kv_store: { [key: string]: any };
}

export function isPanelChat(obj: any): obj is PanelChat {
  return (
    typeof obj.ai_editor === 'string' &&
    typeof obj.id === 'string' &&
    (typeof obj.parent_id === 'string' || obj.parent_id === null) &&
    typeof obj.created_on === 'string' &&
    Array.isArray(obj.messages) && obj.messages.every(isMessageEntry)
  );
}

export interface StashedState {
  panelChats: PanelChat[];
  schemaVersion: string;
  deletedChats: DeletedChats;
  kv_store: { [key: string]: any };
}

export interface ConsolidatedGaitData {
  stashedState: StashedState;
  fileChats: FileChats[];
}

export function readConsolidatedGaitData(gaitDir: string): ConsolidatedGaitData {
    const gaitFilePath = path.join(gaitDir, 'consolidatedGaitData.json');
    const initialState: ConsolidatedGaitData = {
        stashedState: {
            panelChats: [],
            schemaVersion: SCHEMA_VERSION,
            deletedChats: { deletedMessageIDs: [], deletedPanelChatIDs: [] },
            kv_store: {}
        },
        fileChats: []
    };
 
    try {
        if (!fs.existsSync(gaitFilePath)) {
            fs.writeFileSync(gaitFilePath, JSON.stringify(initialState, null, 2), 'utf-8');
            console.log(`consolidatedGaitData.json not found. Initialized with empty data.`);
            return initialState;
        }

        const content = fs.readFileSync(gaitFilePath, 'utf-8').trim();
        if (content === '') {
            fs.writeFileSync(gaitFilePath, JSON.stringify(initialState, null, 2), 'utf-8');
            console.log(`consolidatedGaitData.json is empty. Initialized with empty data.`);
            return initialState;
        }

        return JSON.parse(content);
    } catch (error) {
        console.error(`Error reading consolidatedGaitData.json:`, error);
        vscode.window.showErrorMessage(`consolidatedGaitData.json is malformed. Reinitializing the file.`);
        fs.writeFileSync(gaitFilePath, JSON.stringify(initialState, null, 2), 'utf-8');
        return initialState;
    }
}

export async function writeConsolidatedGaitData(gaitDir: string, data: ConsolidatedGaitData): Promise<void> {
  const gaitFilePath = path.join(gaitDir, 'consolidatedGaitData.json');
  fs.writeFileSync(gaitFilePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function isStashedState(obj: any): obj is StashedState {
  return (
    Array.isArray(obj.panelChats) && obj.panelChats.every(isPanelChat) &&
    typeof obj.schemaVersion === 'string'
  );
}

export interface DeletedChats {
  deletedMessageIDs: string[];
  deletedPanelChatIDs: string[];
}

export interface PanelMatchedRange {
  range: vscode.Range;
  matchedLines: string[];
  panelChat: PanelChat;
  message_id: string;
  similarity: number;
}

export interface StateReader {   
  /**
  * Initializes the extension by reading interactive sessions.
  */
  startInline(inlineStartInfo: InlineStartInfo): Promise<void>;

  /**
  * Processes the editor content during inline chat acceptance.
  */
  acceptInline(editor: vscode.TextEditor): Promise<void>;

  /**
  * Parses the panel chat from interactive sessions and assigns UUIDs based on existing order.
  */
  parsePanelChatAsync(): Promise<PanelChat[]>;
}

export type PanelChatMode = 'AddAllChats' | 'OnlyMatchedChats';
