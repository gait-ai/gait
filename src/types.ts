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
  parent_id: string | null;
  created_on: string;
  messages: MessageEntry[];
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
}

export function isStashedState(obj: any): obj is StashedState {
  return (
    Array.isArray(obj.panelChats) && obj.panelChats.every(isPanelChat) &&
    typeof obj.schemaVersion === 'string'
  );
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
