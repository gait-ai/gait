import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as Inline from './inline';

import simpleGit, { SimpleGit } from 'simple-git';
import { ConsolidatedGaitData } from './types';
import { InlineChatInfo } from './inline';

export type InlineCommitData = {
  commitHash: string;
  date: Date;
  commitMessage: string;
  author: string,
  inlineChats: Inline.InlineChatInfo[];
};

type UncommittedData = {
  inlineChats: Inline.InlineChatInfo[];
};

type GitHistoryData = {
  commits: InlineCommitData[];
  uncommitted: UncommittedData | null;
};

/**
 * Retrieves the Git commit history for inlineChats within a specific file in consolidatedGaitData.json,
 * extracting only newly added chats per commit.
 * @param repoPath - The path to the Git repository.
 * @param filename - The specific filename within inlineChats to retrieve history for.
 * @returns An object containing commit data with only newly added chats and any uncommitted changes.
 */
async function getGitHistory(repoPath: string, filename: string): Promise<GitHistoryData> {
  const git: SimpleGit = simpleGit(repoPath);

  console.log("Starting getGitHistory");
  const filePath = '.gait/consolidatedGaitData.json';
  const absoluteFilePath = path.resolve(repoPath, filePath);

  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`File not found: ${absoluteFilePath}`);
  }

  // Step 1: Get the commit history for consolidatedGaitData.json with --follow to track renames
  // '--reverse' ensures commits are ordered from oldest to newest
  const logArgs = [
    'log',
    '--reverse',
    '--follow',
    '--pretty=format:%H%x09%an%x09%ad%x09%s',
    '--',
    filePath
  ];

  let logData: string;
  try {
    logData = await git.raw(logArgs);
  } catch (error) {
    throw new Error(`Failed to retrieve git log: ${(error as Error).message}`);
  }

  const logLines = logData.split('\n').filter(line => line.trim() !== '');
  const allCommits: InlineCommitData[] = [];
  const previousChats = new Set<string>(); // To track the chats seen in previous commits

  for (const line of logLines) {
    const [commitHash, author, dateStr, ...commitMsgParts] = line.split('\t');
    const commitMessage = commitMsgParts.join('\t');

    // Get the file content at this commit
    let fileContent: string;
    try {
      fileContent = await git.raw(['show', `${commitHash}:${filePath}`]);
    } catch (error) {
      console.warn(`Warning: Could not retrieve file at commit ${commitHash}. It might have been deleted or renamed.`);
      continue; // Skip this commit
    }

    // Parse the JSON content
    let parsedContent: InlineChatInfo[];
    try {
      const consolidatedData = JSON.parse(fileContent) as ConsolidatedGaitData;

      // Find the FileChats object for the specified filename
      const fileChatsObj = consolidatedData.fileChats.find(fc => fc.fileName === filename);
      if (!fileChatsObj) {
        console.warn(`Warning: FileChats for filename "${filename}" not found in commit ${commitHash}.`);
        continue; // Skip if the specified fileChats doesn't exist in this commit
      }

      // Extract InlineChatInfo objects from the fileChats
      parsedContent = Object.values(fileChatsObj.inlineChats);
    } catch (error) {
      console.warn(`Warning: Failed to parse JSON for commit ${commitHash}: ${(error as Error).message}`);
      console.warn(`Content: ${fileContent}`);
      continue; // Skip this commit
    }

    // Identify new chats added in this commit
    const newChats = parsedContent.filter(chat => !previousChats.has(chat.inline_chat_id));
    newChats.forEach(chat => previousChats.add(chat.inline_chat_id)); // Add new chats to the set

    if (newChats.length > 0) {
      const date = new Date(dateStr);

      allCommits.push({
        commitHash,
        date,
        commitMessage,
        author,
        inlineChats: newChats,
      });
    } else {
      console.log(`No new chats added in commit ${commitHash}`);
    }
  }

  // Step 2: Check for uncommitted changes
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
    let currentContent: string;
    try {
      currentContent = fs.readFileSync(absoluteFilePath, 'utf-8');
    } catch (error) {
      console.warn(`Warning: Failed to read current file content: ${(error as Error).message}`);
      currentContent = '{"inlineChats": []}'; // Default to empty inlineChats object
    }

    // Parse the JSON content
    let parsedCurrent: InlineChatInfo[];
    try {
      const consolidatedData = JSON.parse(currentContent) as ConsolidatedGaitData;

      // Find the FileChats object for the specified filename
      const fileChatsObj = consolidatedData.fileChats.find(fc => fc.fileName === filename);
      if (!fileChatsObj) {
        console.warn(`Warning: FileChats for filename "${filename}" not found in current uncommitted changes.`);
        parsedCurrent = [];
      } else {
        // Extract InlineChatInfo objects from the fileChats
        parsedCurrent = Object.values(fileChatsObj.inlineChats);
      }

      if (!Array.isArray(parsedCurrent)) {
        // Handle non-array JSON structures
        console.warn(`Warning: Parsed current content is not an array.`);
        if (parsedCurrent && typeof parsedCurrent === 'object') {
          parsedCurrent = [parsedCurrent as InlineChatInfo];
        } else {
          throw new Error('Parsed current content is neither an array nor an object.');
        }
      }
    } catch (error) {
      console.warn(`Warning: Failed to parse current JSON content: ${(error as Error).message}`);
      parsedCurrent = [];
    }

    // Identify new uncommitted chats
    const newUncommittedChats = parsedCurrent.filter(chat => !previousChats.has(chat.inline_chat_id));

    if (newUncommittedChats.length > 0) {
      uncommitted = {
        inlineChats: newUncommittedChats,
      };
    }
  }

  return {
    commits: allCommits,
    uncommitted,
  };
}

/**
 * Maps each inline_chat_id to the commit that introduced it for a specific filename.
 * @param repoPath - The path to the Git repository.
 * @param filename - The specific filename within inlineChats to retrieve history for.
 * @returns A Map where each key is an inline_chat_id and the value is the InlineCommitData that added it.
 */
export async function getIdToCommitInfo(repoPath: string, filename: string): Promise<Map<string, InlineCommitData>> {
  const gitHistory = await getGitHistory(repoPath, filename);
  const idToCommitInfo = new Map<string, InlineCommitData>();

  for (const commit of gitHistory.commits) {
    for (const chat of commit.inlineChats) {
      idToCommitInfo.set(chat.inline_chat_id, commit);
    }
  }

  return idToCommitInfo;
}


