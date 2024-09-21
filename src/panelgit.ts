
import * as fs from 'fs';
import * as path from 'path';

import simpleGit, { SimpleGit } from 'simple-git';
import { StashedState, PanelChat, isStashedState } from './types';


const SCHEMA_VERSION = '1.0';

export type CommitData = {
    commitHash: string;
    date: Date;
    commitMessage: string;
    author: string;
    panelChats: PanelChat[]; // Updated from messages to panelChats
  };
  
  type UncommittedData = {
    panelChats: PanelChat[]; // Updated from messages to panelChats
  };
  
  export type GitHistoryData = {
    commits: CommitData[];
    uncommitted: UncommittedData | null;
  };

/**
 * Retrieves the Git history for a specific file, capturing PanelChats instead of flat messages.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the target file within the repository.
 * @returns A Promise resolving to GitHistoryData containing commit history and uncommitted changes.
 */
export async function getGitHistory(repoPath: string, filePath: string): Promise<GitHistoryData> {
  const git: SimpleGit = simpleGit(repoPath);

  console.log("Starting getGitHistory");

  // Ensure the file exists in the repository
  const absoluteFilePath = path.resolve(repoPath, filePath);
  if (!fs.existsSync(absoluteFilePath)) {
      throw new Error(`File not found: ${absoluteFilePath}`);
  }

  // Step 1: Read the current stashedPanelChats.json to collect existing message IDs
  let currentContent: string;
  let parsedCurrent: StashedState;
  const currentMessageIds: Set<string> = new Set();

  try {
      currentContent = fs.readFileSync(absoluteFilePath, 'utf-8');
  } catch (error) {
      console.warn(`Warning: Failed to read current file content: ${(error as Error).message}`);
      // If reading fails, default to empty state
      currentContent = JSON.stringify({
          panelChats: [],
          schemaVersion: SCHEMA_VERSION,
          lastAppended: { order: [], lastAppendedMap: {} }
      }, null, 2);
  }

  try {
      parsedCurrent = JSON.parse(currentContent);
      if (!isStashedState(parsedCurrent)) {
          throw new Error('Parsed content does not match StashedState structure.');
      }
  } catch (error) {
      console.warn(`Warning: Failed to parse current JSON content: ${(error as Error).message}`);
      // Default to empty state if parsing fails
      parsedCurrent = {
          panelChats: [],
          schemaVersion: SCHEMA_VERSION,
          lastAppended: { order: [], lastAppendedMap: {} }
      };
  }

  // Collect all current message IDs
  for (const panelChat of parsedCurrent.panelChats) {
      for (const message of panelChat.messages) {
          currentMessageIds.add(message.id);
      }
  }

  // Step 2: Get the commit history for the file with --follow to track renames
  // '--reverse' ensures commits are ordered from oldest to newest
  const logArgs = ['log', '--reverse', '--follow', '--pretty=format:%H%x09%an%x09%ad%x09%s', '--', filePath];

  let logData: string;
  try {
      logData = await git.raw(logArgs);
  } catch (error) {
      throw new Error(`Failed to retrieve git log: ${(error as Error).message}`);
  }

  const logLines = logData.split('\n').filter(line => line.trim() !== '');
  const allCommitsMap: Map<string, CommitData> = new Map();
  const seenMessageIds: Set<string> = new Set();

  for (const line of logLines) {
      const [commitHash, authorName, dateStr, ...commitMsgParts] = line.split('\t');
      const commitMessage = commitMsgParts.join('\t');

      // Skip commits that are solely for deletions
      if (commitMessage.startsWith('Delete message with ID')) {
          console.log(`Skipping deletion commit ${commitHash}: ${commitMessage}`);
          continue;
      }

      // Get the file content at this commit
      let fileContent: string;
      try {
          fileContent = await git.raw(['show', `${commitHash}:${filePath}`]);
      } catch (error) {
          console.warn(`Warning: Could not retrieve file at commit ${commitHash}. It might have been deleted or renamed.`);
          continue; // Skip this commit
      }

      // Parse the JSON content as StashedState
      let parsedContent: StashedState;
      try {
          parsedContent = JSON.parse(fileContent);
          if (!isStashedState(parsedContent)) {
              throw new Error('Parsed content does not match StashedState structure.');
          }
      } catch (error) {
          console.warn(`Warning: Failed to parse JSON for commit ${commitHash}: ${(error as Error).message}`);
          console.warn(`Content: ${fileContent}`);
          continue; // Skip this commit
      }

      // Initialize or retrieve existing CommitData for this commit
      let commitData = allCommitsMap.get(commitHash);
      if (!commitData) {
          commitData = {
              commitHash,
              date: new Date(dateStr),
              commitMessage,
              author: authorName,
              panelChats: [], // Initialize panelChats
          };
          allCommitsMap.set(commitHash, commitData);
      }

      // Iterate through each PanelChat to extract new messages
      for (const panelChat of parsedContent.panelChats) {
          const panelChatId = panelChat.id;

          // Create or retrieve existing PanelChat in commitData
          let existingPanelChat = commitData.panelChats.find(pc => pc.id === panelChatId);
          if (!existingPanelChat) {
              existingPanelChat = {
                  ai_editor: panelChat.ai_editor,
                  id: panelChat.id,
                  customTitle: panelChat.customTitle,
                  parent_id: panelChat.parent_id,
                  created_on: panelChat.created_on,
                  messages: []
              };
              commitData.panelChats.push(existingPanelChat);
          }

          for (const messageEntry of panelChat.messages) {
              const messageId = messageEntry.id;

              // **New Logic:** Only include messages that currently exist (i.e., haven't been deleted)
              if (currentMessageIds.has(messageId)) {
                  if (!seenMessageIds.has(messageId)) {
                      // New message found
                      existingPanelChat.messages.push(messageEntry);
                      console.log(`Added message ID ${messageId} from PanelChat ${panelChatId} in commit ${commitHash}.`);
                      seenMessageIds.add(messageId);
                  } else {
                      console.log(`Message ID ${messageId} already seen. Skipping.`);
                  }
              } else {
                  console.log(`Message ID ${messageId} has been deleted. Excluding from commit ${commitHash}.`);
              }
          }
      }
  }

  // Convert the map to an array
  let allCommits: CommitData[] = Array.from(allCommitsMap.values());

  // **New Addition:** Filter out commits with empty panelChats
  allCommits = allCommits.filter(commit => commit.panelChats.some(pc => pc.messages.length > 0));
  console.log(`Filtered commits to exclude empty ones. Remaining commits count: ${allCommits.length}`);

  // Step 3: Check for uncommitted changes
  let status;
  try {
      status = await git.status();
  } catch (error) {
      throw new Error(`Failed to retrieve git status: ${(error as Error).message}`);
  }

  let uncommitted: UncommittedData | null = null;
  console.log("Checking uncommitted changes");
  if (
      status.modified.includes(filePath) ||
      status.not_added.includes(filePath) ||
      status.created.includes(filePath)
  ) {
      // Get the current (uncommitted) file content
      console.log("stashedPanelChats.json is modified");
      let currentUncommittedContent: string;
      try {
          currentUncommittedContent = fs.readFileSync(absoluteFilePath, 'utf-8');
      } catch (error) {
          console.warn(`Warning: Failed to read current file content: ${(error as Error).message}`);
          currentUncommittedContent = JSON.stringify({
              panelChats: [],
              schemaVersion: SCHEMA_VERSION,
              lastAppended: { order: [], lastAppendedMap: {} }
          }, null, 2); // Default to empty StashedState
      }

      // Parse the JSON content as StashedState
      let parsedUncommitted: StashedState;
      try {
          parsedUncommitted = JSON.parse(currentUncommittedContent);
          if (!isStashedState(parsedUncommitted)) {
              throw new Error('Parsed content does not match StashedState structure.');
          }
      } catch (error) {
          console.warn(`Warning: Failed to parse current JSON content: ${(error as Error).message}`);
          parsedUncommitted = {
              panelChats: [],
              schemaVersion: SCHEMA_VERSION,
              lastAppended: { order: [], lastAppendedMap: {} }
          }; // Default to empty StashedState
      }

      // Aggregate all panelChats from uncommitted changes
      const allCurrentPanelChats: PanelChat[] = parsedUncommitted.panelChats;
      console.log("All current uncommitted panelChats:");
      console.log(allCurrentPanelChats);

      // Determine new uncommitted panelChats based on currentMessageIds
      const newUncommittedPanelChats: PanelChat[] = allCurrentPanelChats.map(pc => {
          const filteredMessages = pc.messages.filter(msg => currentMessageIds.has(msg.id) && !seenMessageIds.has(msg.id));
          return {
              ai_editor: pc.ai_editor,
              id: pc.id,
              customTitle: pc.customTitle,
              parent_id: pc.parent_id,
              created_on: pc.created_on,
              messages: filteredMessages
          };
      }).filter(pc => pc.messages.length > 0);

      if (newUncommittedPanelChats.length > 0) {
          uncommitted = {
              panelChats: newUncommittedPanelChats,
          };
          console.log(`Found ${newUncommittedPanelChats.length} uncommitted new panelChats.`);
      } else {
          console.log("No uncommitted new panelChats found.");
      }
  }

  console.log("Returning commits and uncommitted data.");
  console.log(allCommits);
  console.log(uncommitted);
  return {
      commits: allCommits,
      uncommitted,
  };
}

/**
 * Retrieves the Git history for a specific file, but only includes commits that have modified an additional target file.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the main target file within the repository.
 * @param targetFilePath - The relative path to the additional file to filter commits by.
 * @returns A Promise resolving to GitHistoryData containing filtered commit history and uncommitted changes.
 */
export async function getGitHistoryThatTouchesFile(repoPath: string, filePath: string, targetFilePath: string): Promise<GitHistoryData> {
  const git: SimpleGit = simpleGit(repoPath);

  console.log("Starting getGitHistoryThatTouchesFile");

  // Ensure both files exist in the repository
  const absoluteFilePath = path.resolve(repoPath, filePath);
  const absoluteTargetFilePath = path.resolve(repoPath, targetFilePath);
  if (!fs.existsSync(absoluteFilePath)) {
      throw new Error(`File not found: ${absoluteFilePath}`);
  }
  if (!fs.existsSync(absoluteTargetFilePath)) {
      throw new Error(`Target file not found: ${absoluteTargetFilePath}`);
  }

  // Step 1: Read the current stashedPanelChats.json to collect existing message IDs
  let currentContent: string;
  let parsedCurrent: StashedState;
  const currentMessageIds: Set<string> = new Set();

  try {
      currentContent = fs.readFileSync(absoluteFilePath, 'utf-8');
  } catch (error) {
      console.warn(`Warning: Failed to read current file content: ${(error as Error).message}`);
      // If reading fails, default to empty state
      currentContent = JSON.stringify({
          panelChats: [],
          schemaVersion: SCHEMA_VERSION,
          lastAppended: { order: [], lastAppendedMap: {} }
      }, null, 2);
  }

  try {
      parsedCurrent = JSON.parse(currentContent);
      if (!isStashedState(parsedCurrent)) {
          throw new Error('Parsed content does not match StashedState structure.');
      }
  } catch (error) {
      console.warn(`Warning: Failed to parse current JSON content: ${(error as Error).message}`);
      // Default to empty state if parsing fails
      parsedCurrent = {
          panelChats: [],
          schemaVersion: SCHEMA_VERSION,
          lastAppended: { order: [], lastAppendedMap: {} }
      };
  }

  // Collect all current message IDs
  for (const panelChat of parsedCurrent.panelChats) {
      for (const message of panelChat.messages) {
          currentMessageIds.add(message.id);
      }
  }

  console.log(`Current Message IDs: ${Array.from(currentMessageIds).join(', ')}`);

  // Step 2: Get the commit history for the main file with --follow to track renames
  // '--reverse' ensures commits are ordered from oldest to newest
  const logArgs = ['log', '--reverse', '--follow', '--pretty=format:%H%x09%an%x09%ad%x09%s', '--', filePath];

  let logData: string;
  try {
      logData = await git.raw(logArgs);
  } catch (error) {
      throw new Error(`Failed to retrieve git log for ${filePath}: ${(error as Error).message}`);
  }

  const logLines = logData.split('\n').filter(line => line.trim() !== '');
  const allCommitsMap: Map<string, CommitData> = new Map();
  const seenMessageIds: Set<string> = new Set();

  for (const line of logLines) {
      console.log("Processing Line: ", line);
      const [commitHash, authorName, dateStr, ...commitMsgParts] = line.split('\t');
      const commitMessage = commitMsgParts.join('\t');

      // Skip commits that are solely for deletions
      if (commitMessage.startsWith('Delete message with ID')) {
          console.log(`Skipping deletion commit ${commitHash}: ${commitMessage}`);
          continue;
      }

      // Check if this commit also modifies the targetFilePath
      let modifiesTargetFile = false;
      try {
          const filesChanged = await git.raw(['diff-tree', '--no-commit-id', '--name-only', '-r', commitHash]);
          const files = filesChanged.split('\n').map(f => f.trim());
          if (files.includes(targetFilePath)) {
              modifiesTargetFile = true;
          }
      } catch (error) {
          console.warn(`Warning: Failed to retrieve files changed in commit ${commitHash}: ${(error as Error).message}`);
          continue; // Skip this commit
      }

      if (!modifiesTargetFile) {
          console.log(`Commit ${commitHash} does not modify target file ${targetFilePath}. Skipping.`);
          continue; // Skip commits that do not modify the target file
      }

      // Get the main file content at this commit
      let fileContent: string;
      try {
          fileContent = await git.raw(['show', `${commitHash}:${filePath}`]);
      } catch (error) {
          console.warn(`Warning: Could not retrieve file at commit ${commitHash}. It might have been deleted or renamed.`);
          continue; // Skip this commit
      }

      // Parse the JSON content as StashedState
      let parsedContent: StashedState;
      try {
          parsedContent = JSON.parse(fileContent);
          if (!isStashedState(parsedContent)) {
              throw new Error('Parsed content does not match StashedState structure.');
          }
      } catch (error) {
          console.warn(`Warning: Failed to parse JSON for commit ${commitHash}: ${(error as Error).message}`);
          console.warn(`Content: ${fileContent}`);
          continue; // Skip this commit
      }

      // Initialize or retrieve existing CommitData for this commit
      let commitData = allCommitsMap.get(commitHash);
      if (!commitData) {
          commitData = {
              commitHash,
              date: new Date(dateStr),
              commitMessage,
              author: authorName,
              panelChats: [], // Initialize panelChats
          };
          allCommitsMap.set(commitHash, commitData);
      }

      // Iterate through each PanelChat to extract new messages
      for (const panelChat of parsedContent.panelChats) {
          const panelChatId = panelChat.id;

          // Create or retrieve existing PanelChat in commitData
          let existingPanelChat = commitData.panelChats.find(pc => pc.id === panelChatId);
          if (!existingPanelChat) {
              existingPanelChat = {
                  ai_editor: panelChat.ai_editor,
                  id: panelChat.id,
                  customTitle: panelChat.customTitle,
                  parent_id: panelChat.parent_id,
                  created_on: panelChat.created_on,
                  messages: []
              };
              commitData.panelChats.push(existingPanelChat);
          }

          for (const messageEntry of panelChat.messages) {
              const messageId = messageEntry.id;

              // **New Logic:** Only include messages that currently exist (i.e., haven't been deleted)
              if (currentMessageIds.has(messageId)) {
                  if (!seenMessageIds.has(messageId)) {
                      // New message found
                      existingPanelChat.messages.push(messageEntry);
                      console.log(`Added message ID ${messageId} from PanelChat ${panelChatId} in commit ${commitHash}.`);
                      seenMessageIds.add(messageId);
                  } else {
                      console.log(`Message ID ${messageId} already seen. Skipping.`);
                  }
              } else {
                  console.log(`Message ID ${messageId} has been deleted. Excluding from commit ${commitHash}.`);
              }
          }
      }
  }

  // Convert the map to an array
  let allCommits: CommitData[] = Array.from(allCommitsMap.values());

  // **New Addition:** Filter out commits with empty panelChats
  allCommits = allCommits.filter(commit => commit.panelChats.some(pc => pc.messages.length > 0));
  console.log(`Filtered commits to exclude empty ones. Remaining commits count: ${allCommits.length}`);

  // Step 3: Check for uncommitted changes
  let status;
  try {
      status = await git.status();
  } catch (error) {
      throw new Error(`Failed to retrieve git status: ${(error as Error).message}`);
  }

  let uncommitted: UncommittedData | null = null;
  console.log("Checking uncommitted changes");
  if (
      status.modified.includes(filePath) ||
      status.not_added.includes(filePath) ||
      status.created.includes(filePath)
  ) {
      // Get the current (uncommitted) file content
      console.log("stashedPanelChats.json is modified");
      let currentUncommittedContent: string;
      try {
          currentUncommittedContent = fs.readFileSync(absoluteFilePath, 'utf-8');
      } catch (error) {
          console.warn(`Warning: Failed to read current file content: ${(error as Error).message}`);
          currentUncommittedContent = JSON.stringify({
              panelChats: [],
              schemaVersion: SCHEMA_VERSION,
              lastAppended: { order: [], lastAppendedMap: {} }
          }, null, 2); // Default to empty StashedState
      }

      // Parse the JSON content as StashedState
      let parsedUncommitted: StashedState;
      try {
          parsedUncommitted = JSON.parse(currentUncommittedContent);
          if (!isStashedState(parsedUncommitted)) {
              throw new Error('Parsed content does not match StashedState structure.');
          }
      } catch (error) {
          console.warn(`Warning: Failed to parse current JSON content: ${(error as Error).message}`);
          parsedUncommitted = {
              panelChats: [],
              schemaVersion: SCHEMA_VERSION,
              lastAppended: { order: [], lastAppendedMap: {} }
          }; // Default to empty StashedState
      }

      // Aggregate all panelChats from uncommitted changes
      const allCurrentPanelChats: PanelChat[] = parsedUncommitted.panelChats;
      console.log("All current uncommitted panelChats:");
      console.log(allCurrentPanelChats);

      // Determine new uncommitted panelChats based on currentMessageIds
      const newUncommittedPanelChats: PanelChat[] = allCurrentPanelChats.map(pc => {
          const filteredMessages = pc.messages.filter(msg => currentMessageIds.has(msg.id) && !seenMessageIds.has(msg.id));
          return {
              ai_editor: pc.ai_editor,
              id: pc.id,
              customTitle: pc.customTitle,
              parent_id: pc.parent_id,
              created_on: pc.created_on,
              messages: filteredMessages
          };
      }).filter(pc => pc.messages.length > 0);

      if (newUncommittedPanelChats.length > 0) {
          uncommitted = {
              panelChats: newUncommittedPanelChats,
          };
          console.log(`Found ${newUncommittedPanelChats.length} uncommitted new panelChats.`);
      } else {
          console.log("No uncommitted new panelChats found.");
      }
  }

  console.log("Returning commits and uncommitted data.");
  console.log(allCommits);
  console.log(uncommitted);
  return {
      commits: allCommits,
      uncommitted,
  };
}

/**
 * Maps each message ID to its corresponding CommitData.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the target file within the repository.
 * @returns A Promise resolving to a Map where each key is a message ID and the value is its CommitData.
 */
export async function getIdToCommitInfo(repoPath: string, filePath: string): Promise<Map<string, CommitData>> {
  const gitHistory  = await getGitHistory(repoPath, filePath);
  const idToCommitInfo = new Map<string, CommitData>();
  for (const commit of gitHistory.commits) {
    for (const panelChat of commit.panelChats) { // Updated to iterate through panelChats
      for (const message of panelChat.messages) { // Iterate through messages within each panelChat
        idToCommitInfo.set(message.id, commit);
      }
    }
  }
  return idToCommitInfo;
}