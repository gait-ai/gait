import * as vscode from 'vscode';
import * as Diff from 'diff';
import * as Inline from '../inline';
import { readVSCodeState } from '../tools/dbReader';
import { Context, MessageEntry, PanelChat, StashedState } from '../types';
import { v4 as uuidv4 } from 'uuid';
const SCHEMA_VERSION = '1.0';


/**
 * Interface representing an interactive session.
 */
interface InteractiveSession {
    history: {
        editor: {
            text: string;
            state: {
                chatContextAttachments: any[];
                chatDynamicVariableModel: any[];
            }
        }[];
        copilot: any[];
    }
}


/**
 * Validates if the object is a valid InteractiveSession.
 */
function isValidInteractiveSession(obj: any): obj is InteractiveSession {
    return (
        obj &&
        typeof obj === 'object' &&
        obj.history &&
        Array.isArray(obj.history.editor) &&
        obj.history.editor.every((entry: any) =>
            typeof entry.text === 'string' &&
            entry.state &&
            Array.isArray(entry.state.chatContextAttachments) &&
            Array.isArray(entry.state.chatDynamicVariableModel)
        )
    );
}

/**
 * Retrieves a single new editor text from the sessions.
 */
function getSingleNewEditorText(oldSessions: InteractiveSession, newSessions: InteractiveSession): string {
    const oldEditorTexts = new Set(oldSessions.history.editor.map(entry => entry.text));
    const newEditorTexts = newSessions.history.editor
        .filter(entry => entry.text && !oldEditorTexts.has(entry.text))
        .map(entry => entry.text);

    if (newEditorTexts.length !== 1) {
        throw new Error(newEditorTexts.length === 0 ? "No new editor text found." : "Multiple new editor texts found.");
    }

    return newEditorTexts[0];
}


/**
 * Initializes the extension by reading interactive sessions.
 */
export async function startInline(context: vscode.ExtensionContext) {
    const interactiveSessions = await readVSCodeState(context, 'memento/interactive-session');
    await context.workspaceState.update('memento/interactive-session', interactiveSessions);
}

/**
 * Processes the editor content during inline chat acceptance.
 */
export async function acceptInline(context: vscode.ExtensionContext, editor: vscode.TextEditor) {
    const oldInteractiveSessions: any = context.workspaceState.get('memento/interactive-session');
    if (!isValidInteractiveSession(oldInteractiveSessions)) {
        throw new Error('Old interactive sessions are invalid or not found.');
    }

    const newContent = editor.document.getText();
    const lastInline = context.workspaceState.get("last_inline_start");

    if (Inline.isInlineStartInfo(lastInline)) {
        const diff = Diff.diffLines(lastInline.content, newContent);
        await vscode.commands.executeCommand('inlineChat.acceptChanges');

        await new Promise(resolve => setTimeout(resolve, 2000));
        const newInteractiveSessions: any = await readVSCodeState(context, 'memento/interactive-session');
        
        if (!isValidInteractiveSession(newInteractiveSessions)) {
            throw new Error('New interactive sessions are invalid or not found.');
        }
        const newChat = getSingleNewEditorText(oldInteractiveSessions, newInteractiveSessions);
        const inlineChatInfoObj = Inline.InlineStartToInlineChatInfo(lastInline, diff, newChat);

        Inline.writeInlineChat(inlineChatInfoObj);
    } else {
        throw new Error('No valid content stored in last_inline_start');
    }
}


/**
 * Parses the panel chat from interactive sessions and assigns UUIDs based on existing order.
 */
export async function parsePanelChatAsync(
    context: vscode.ExtensionContext,
    existingIds: string[]
  ): Promise<StashedState> {
    try {
      const interactiveSessions = await readVSCodeState(context, 'interactive.sessions');
  
      if (!Array.isArray(interactiveSessions)) {
        vscode.window.showErrorMessage('Interactive sessions data is not an array.');
        return { panelChats: [], schemaVersion: SCHEMA_VERSION, lastAppended: { order: [], lastAppendedMap: {} } };
      }
  
      const panelChats: PanelChat[] = interactiveSessions.map((panel: any, index: number) => {
        const ai_editor: string = "copilot";
        const customTitle: string = typeof panel.customTitle === 'string' ? panel.customTitle : '';
  
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
        //console.log(`Parsing panel chat with ${panel.requests.length} sessions.`);
        //console.log(panel);
  
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
  
          //console.log(`Parsed message: ${messageText} -> ${responseText}`);
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
  
        //console.log(`Parsed panel chat with ${messages.length} messages.`);
        return {
          ai_editor,
          customTitle,
          id,
          parent_id,
          created_on,
          messages,
        } as PanelChat;
      });
  
      return { panelChats, schemaVersion: SCHEMA_VERSION, lastAppended: { order: [], lastAppendedMap: {} } };
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to parse panel chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { panelChats: [], schemaVersion: SCHEMA_VERSION, lastAppended: { order: [], lastAppendedMap: {} } };
    }
  }