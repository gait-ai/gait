import * as vscode from 'vscode';
import { InlineStartInfo } from './inline';

export interface Context {
	context_type: string
	key: string
	value: string
}

function isContext(obj: any): obj is Context {
  return (
    typeof obj.context_type === 'string' &&
    typeof obj.key === 'string' &&
    typeof obj.value === 'string'
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

export interface LastAppended {
  order: string[]; // Ordered list of PanelChat UUIDs
  lastAppendedMap: { [panelChatId: string]: number };
}

export function isLastAppended(obj: any): obj is LastAppended {
  return (
    Array.isArray(obj.order) && obj.order.every((id: any) => typeof id === 'string') &&
    typeof obj.lastAppendedMap === 'object' && obj.lastAppendedMap !== null &&
    Object.values(obj.lastAppendedMap).every((value: any) => typeof value === 'number')
  );
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

