import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as Inline from './inline';

import simpleGit, { SimpleGit } from 'simple-git';

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
 * Retrieves the Git commit history for a specified file, extracting only newly added chats per commit.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the target file within the repository.
 * @returns An object containing commit data with only newly added chats and any uncommitted changes.
 */
async function getGitHistory(repoPath: string, filePath: string): Promise<GitHistoryData> {
  const git: SimpleGit = simpleGit(repoPath);

  console.log("Starting getGitHistory");
  // Ensure the file exists in the repository
  const absoluteFilePath = path.resolve(repoPath, filePath);
  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`File not found: ${absoluteFilePath}`);
  }

  // Step 1: Get the commit history for the file with --follow to track renames
  // '--reverse' ensures commits are ordered from oldest to newest
  const logArgs = ['log', '--reverse', '--follow', '--pretty=format:%H%x09%an%x09%ad%x09%s', '--', filePath];

  let logData: string;
  try {
    logData = await git.raw(logArgs);
  } catch (error) {
    throw new Error(`Failed to retrieve git log: ${(error as Error).message}`);
  }

  const logLines = logData.split('\n').filter(line => line.trim() !== '');
  const allCommits: InlineCommitData[] = [];
  let previousChats = new Set<string>(); // To track the chats seen in previous commits

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
    let parsedContent: Inline.InlineChatInfo[];
    try {
      const fileChats = JSON.parse(fileContent) as Inline.FileChats;
      parsedContent = Object.values(fileChats.inlineChats) ;
      if (!Array.isArray(parsedContent)) {
        // Handle non-array JSON structures if necessary
        console.warn(`Warning: Parsed content is not an array for commit ${commitHash}. Attempting to handle as object.`);
        if (parsedContent && typeof parsedContent === 'object') {
          parsedContent = [parsedContent as Inline.InlineChatInfo];
        } else {
          throw new Error('Parsed content is neither an array nor an object.');
        }
      }
    } catch (error) {
      console.warn(`Warning: Failed to parse JSON for commit ${commitHash}: ${(error as Error).message}`);
      console.warn(`Content: ${fileContent}`);
      continue; // Skip this commit
    }

    const newChats = parsedContent.filter(chat => !previousChats.has(chat.inline_chat_id)); // Extract only new chats
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
      currentContent = '[]'; // Default to empty array
    }

    // Parse the JSON content
    let parsedCurrent: Inline.InlineChatInfo[];
    try {
      const fileChats = JSON.parse(currentContent) as Inline.FileChats;
      parsedCurrent = Object.values(fileChats.inlineChats) ;
      if (!Array.isArray(parsedCurrent)) {
        // Handle non-array structures
        console.warn(`Warning: Parsed current content is not an array.`);
        if (parsedCurrent && typeof parsedCurrent === 'object') {
          parsedCurrent = [parsedCurrent as Inline.InlineChatInfo];
        } else {
          throw new Error('Parsed current content is neither an array nor an object.');
        }
      }
    } catch (error) {
      console.warn(`Warning: Failed to parse current JSON content: ${(error as Error).message}`);
      parsedCurrent = [];
    }

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

export async function getIdToCommitInfo(repoPath: string, filePath: string): Promise<Map<string, InlineCommitData>> {
  const gitHistory  = await getGitHistory(repoPath, filePath);
  const idToCommitInfo = new Map<string, InlineCommitData>();
  for (const commit of gitHistory.commits) {
    for (const chat of commit.inlineChats) {
      idToCommitInfo.set(chat.inline_chat_id, commit);
    }
  }
  return idToCommitInfo;
}

