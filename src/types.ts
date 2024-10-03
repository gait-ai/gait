import * as vscode from 'vscode';
import { InlineChatInfo, InlineStartInfo, FileDiff, isInlineChatInfo } from './inline';

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
  inlineChats: InlineChatInfo[];
  schemaVersion: string;
  deletedChats: DeletedChats;
  kv_store: { [key: string]: any };
}

export function isStashedState(obj: any): obj is StashedState {
  return (
    Array.isArray(obj.panelChats) && obj.panelChats.every(isPanelChat) &&
    typeof obj.schemaVersion === 'string' && Array.isArray(obj.inlineChats) && obj.inlineChats.every(isInlineChatInfo)
    && isDeletedChats(obj.deletedChats) && typeof obj.kv_store === 'object' 
  );
}

export interface DeletedChats {
  deletedMessageIDs: string[];
  deletedPanelChatIDs: string[];
}

export function isDeletedChats(obj: any): obj is DeletedChats {
  return (
    obj &&
    Array.isArray(obj.deletedMessageIDs) &&
    obj.deletedMessageIDs.every((id: any) => typeof id === 'string') &&
    Array.isArray(obj.deletedPanelChatIDs) &&
    obj.deletedPanelChatIDs.every((id: any) => typeof id === 'string')
  );
}

export interface PanelMatchedRange {
  range: vscode.Range;
  panelChat: PanelChat;
  message_id: string;
}

export interface AIChangeMetadata {
  changeStartPosition: vscode.Position | undefined;
  inlineChatStartInfo: InlineStartInfo | undefined;
}
export interface TimedFileDiffs {
  timestamp: string;
  file_diffs: FileDiff[]
  metadata: AIChangeMetadata;
}


export interface StateReader {   
  /**
  * Initializes the extension by reading interactive sessions.
  */
  startInline(inlineStartInfo: InlineStartInfo): Promise<void>;

  /**
  * Processes the editor content during inline chat acceptance.
  */
  pushFileDiffs(file_diffs: FileDiff[], metadata: AIChangeMetadata): void;

  /**
  * Processes the editor content during inline chat acceptance.
  */
  matchPromptsToDiff(): Promise<boolean>;

  /**
  * Parses the panel chat from interactive sessions and assigns UUIDs based on existing order.
  */
  parsePanelChatAsync(): Promise<PanelChat[]>;
}

export type PanelChatMode = 'AddAllChats' | 'OnlyMatchedChats';
