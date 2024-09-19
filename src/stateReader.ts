import { PanelChat } from './types';

export interface StateReader {
  /**
   * Reads and parses the state into PanelChats.
   * @returns A promise that resolves to an array of PanelChats.
   */
  readPanelChats(): Promise<PanelChat[]>;

  /**
   * Retrieves the prompt for inline chats.
   * @returns A promise that resolves to a string containing the inline chat prompt.
   */
  getInlineChatPrompt(): Promise<string>;
}
