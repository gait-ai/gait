import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import simpleGit, { SimpleGit } from 'simple-git';
import { StashedState, PanelChat, isStashedState, isPanelChat } from './types';
import { InlineChatInfo } from './inline';
import { readStashedState } from './stashedState'; // Ensure this does not use gzip
import { execFile } from 'child_process';
import { promisify } from 'util';
import posthog from 'posthog-js';
import { getWorkspaceFolderPath } from './utils';

const SCHEMA_VERSION = '1.0';

export type CommitData = {
    commitHash: string;
    date: Date;
    commitMessage: string;
    author: string;
    panelChats: PanelChat[];
    inlineChats: InlineChatInfo[];
};

export type UncommittedData = {
    panelChats: PanelChat[];
    inlineChats: InlineChatInfo[];
};

export type GitHistoryData = {
    commits: CommitData[];
    added: UncommittedData | null;
    uncommitted: UncommittedData | null;
};

enum LogLevel {
    INFO,
    WARN,
    ERROR
}

const CURRENT_LOG_LEVEL = LogLevel.INFO;

/**
 * Logs messages based on the specified log level.
 * @param message - The message to log.
 * @param level - The severity level of the log.
 */
function log(message: string, level: LogLevel = LogLevel.INFO) {
    if (level >= CURRENT_LOG_LEVEL) {
        switch (level) {
            case LogLevel.INFO:
                // console.log(message);
            case LogLevel.WARN:
                // console.warn(message);
                break;
            case LogLevel.ERROR:
                // console.error(message);
                break;
        }
    }
}

const execFileAsync = promisify(execFile);

/**
 * Executes a Git command and returns the output as a string.
 * @param args - Array of Git command arguments.
 * @param repoPath - The path to the Git repository.
 * @returns A Promise resolving to a string containing the command output.
 */
async function gitShowString(args: string[], repoPath: string): Promise<string> {
    try {
        const { stdout } = await execFileAsync('git', args, {
            cwd: repoPath,
            maxBuffer: 1024 * 1024 * 1024 // 1 GB buffer
        });
        return stdout;
    } catch (error) {
        if ((error as any).code === 'ENOBUFS') {
            throw new Error('Git command failed: Output exceeded buffer size. The file might be too large.');
        }
        throw new Error(`Git command failed: ${(error as Error).message}`);
    }
}


/**
 * Processes a single commit's state.json and extracts active PanelChats and Messages.
 * @param parsedContent - The parsed StashedState from the commit.
 * @param currentMessageIds - Set of active message IDs.
 * @param currentInlineChatIds - Set of active inline chat IDs.
 * @param seenMessageIds - Set to track already processed message IDs.
 * @param commitData - The CommitData object to populate.
 * @param commitHash - The hash of the current commit (for logging purposes).
 */
function processCommit(
    parsedContent: StashedState,
    currentMessageIds: Set<string>,
    currentInlineChatIds: Set<string>,
    seenMessageIds: Set<string>,
    commitData: CommitData,
    commitHash: string
) {
    log(`Processing Commit Hash: ${commitHash}`, LogLevel.INFO);

    const { deletedChats } = parsedContent;
    const deletedPanelChatIds = new Set(deletedChats.deletedPanelChatIDs);
    const deletedMessageIds = new Set(deletedChats.deletedMessageIDs);

    // Process Inline Chats
    if (Array.isArray(parsedContent.inlineChats)) {
        for (const inlineChat of parsedContent.inlineChats) {
            const inlineChatId = inlineChat.inline_chat_id;
            if (!currentInlineChatIds.has(inlineChatId)) {
                commitData.inlineChats.push(inlineChat);
            }
        }
    }

    // Process Panel Chats
    for (const panelChat of parsedContent.panelChats) {
        const panelChatId = panelChat.id;

        // Skip deleted PanelChats
        if (deletedPanelChatIds.has(panelChatId)) {
            log(`PanelChat ID ${panelChatId} has been deleted in commit ${commitHash}. Excluding from processing.`, LogLevel.INFO);
            continue;
        }

        // Retrieve or initialize existing PanelChat in commitData
        let existingPanelChat = commitData.panelChats.find(pc => pc.id === panelChatId);
        if (!existingPanelChat) {
            existingPanelChat = { ...panelChat, messages: [], kv_store: {} };
            commitData.panelChats.push(existingPanelChat);
            log(`Initialized PanelChat ID ${panelChatId} in commit ${commitHash}.`, LogLevel.INFO);
        }

        // Process Messages within PanelChat
        for (const message of panelChat.messages) {
            const messageId = message.id;

            if (currentMessageIds.has(messageId) && !seenMessageIds.has(messageId) && !deletedMessageIds.has(messageId)) {
                existingPanelChat.messages.push(message);
                log(`Added Message ID ${messageId} from PanelChat ${panelChatId} in commit ${commitHash}.`, LogLevel.INFO);
                seenMessageIds.add(messageId);
            } else {
                if (!currentMessageIds.has(messageId)) {
                    log(`Message ID ${messageId} has been deleted in the current state. Excluding from commit ${commitHash}.`, LogLevel.INFO);
                } else {
                    log(`Message ID ${messageId} has already been processed. Skipping.`, LogLevel.INFO);
                }
            }
        }
    }
}



/**
 * Aggregates active PanelChat and InlineChat IDs from the current stashed state.
 * @param parsedCurrent - The current StashedState.
 * @returns An object containing sets of active PanelChat and Message IDs, and active InlineChat IDs.
 */
function aggregateCurrentIds(parsedCurrent: StashedState) {
    const currentMessageIds: Set<string> = new Set();
    const currentPanelChatIds: Set<string> = new Set();
    const currentInlineChatIds: Set<string> = new Set();

    const { deletedChats, panelChats, inlineChats } = parsedCurrent;
    const deletedPanelChatIds = new Set(deletedChats.deletedPanelChatIDs);
    const deletedMessageIds = new Set(deletedChats.deletedMessageIDs);

    for (const panelChat of panelChats) {
        if (!deletedPanelChatIds.has(panelChat.id)) {
            currentPanelChatIds.add(panelChat.id);
            for (const message of panelChat.messages) {
                if (!deletedMessageIds.has(message.id)) {
                    currentMessageIds.add(message.id);
                }
            }
        }
    }

    for (const inlineChat of inlineChats) {
        currentInlineChatIds.add(inlineChat.inline_chat_id);
    }

    log(`Collected ${currentPanelChatIds.size} active PanelChat IDs, ${currentMessageIds.size} active Message IDs, and ${currentInlineChatIds.size} active InlineChat IDs.`, LogLevel.INFO);

    return { currentMessageIds, currentPanelChatIds, currentInlineChatIds };
}

/**
 * Retrieves the Git history for a specific file, capturing PanelChats instead of flat messages.
 * @param context - The VSCode extension context.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the target file within the repository.
 * @returns A Promise resolving to GitHistoryData containing commit history and uncommitted changes.
 */
export async function getGitHistory(context: vscode.ExtensionContext, repoPath: string, filePath: string): Promise<GitHistoryData> {
    console.log('Starting getGitHistory function');
    try {
        const workspacePath = getWorkspaceFolderPath();
        console.log('Workspace path:', workspacePath);

        const git: SimpleGit = simpleGit(workspacePath);
        console.log('SimpleGit initialized');

        if (!fs.existsSync(path.join(workspacePath, '.git'))) {
            console.log('Not a git repository');
            throw new Error('Not a git repository');
        }

        console.log('Fetching git logs');
        const logs = await git.log({ file: filePath });
        console.log(`Found ${logs.all.length} commits`);

        // Get the current branch name
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        console.log(`Current branch: ${currentBranch}`);

        const commits: CommitData[] = [];

        for (const log of logs.all) {
            console.log(`Processing commit: ${log.hash}`);
            const commitHash = log.hash;
            
            console.log(`Checking out commit: ${commitHash}`);
            await git.checkout(commitHash);

            const fullFilePath = path.join(workspacePath, filePath);
            console.log(`Checking file: ${fullFilePath}`);

            let panelChats: PanelChat[] = [];
            let inlineChats: InlineChatInfo[] = [];

            if (fs.existsSync(fullFilePath)) {
                console.log('File exists, reading content');
                const fileContent = fs.readFileSync(fullFilePath, 'utf8');
                try {
                    const stashedState = JSON.parse(fileContent);
                    panelChats = stashedState.panelChats || [];
                    inlineChats = stashedState.inlineChats || [];
                    console.log(`Found ${panelChats.length} panel chats and ${inlineChats.length} inline chats`);
                } catch (parseError) {
                    console.error('Error parsing file content:', parseError);
                }
            } else {
                console.log('File does not exist in this commit');
            }

            commits.push({
                commitHash: commitHash,
                author: log.author_name,
                date: new Date(log.date),
                commitMessage: log.message,
                panelChats: panelChats,
                inlineChats: inlineChats
            });
        }

        console.log(`Checking out back to original branch: ${currentBranch}`);
        await git.checkout(currentBranch);

        console.log('Getting uncommitted changes');
        const stashedState = readStashedState(context);
        const uncommitted = {
            panelChats: stashedState.panelChats,
            inlineChats: stashedState.inlineChats
        };

        console.log('Getting staged changes');
        const stagedFiles = await git.diff(['--cached', '--name-only']);
        const added = {
            panelChats: [] as PanelChat[],
            inlineChats: [] as InlineChatInfo[]
        };

        if (stagedFiles.includes(filePath)) {
            console.log('File is staged, reading staged content');
            const stagedContent = await git.show([':', filePath]);
            try {
                const stagedState = JSON.parse(stagedContent);
                added.panelChats = stagedState.panelChats || [];
                added.inlineChats = stagedState.inlineChats || [];
            } catch (parseError) {
                console.error('Error parsing staged content:', parseError);
            }
        }

        console.log('Finished processing git history');
        return { commits, uncommitted, added };
    } catch (error) {
        console.error('Error in getGitHistory:', error);
        throw error;
    }
}

/**
 * Retrieves the Git history for a specific file that also touches a target file.
 * @param context - The VSCode extension context.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the main target file within the repository.
 * @param targetFilePath - The relative path to the additional target file within the repository.
 * @returns A Promise resolving to GitHistoryData containing commit history and uncommitted changes.
 */
export async function getGitHistoryThatTouchesFile(
    context: vscode.ExtensionContext,
    repoPath: string,
    filePath: string,
    targetFilePath: string
): Promise<GitHistoryData> {
    const git: SimpleGit = simpleGit(repoPath);
    log("Starting getGitHistoryThatTouchesFile", LogLevel.INFO);
    // Ensure both files exist in the repository
    const absoluteFilePath = path.resolve(repoPath, filePath);
    const absoluteTargetFilePath = path.resolve(repoPath, targetFilePath);
    if (!fs.existsSync(absoluteFilePath)) {
        throw new Error(`File not found: ${absoluteFilePath}`);
    }
    if (!fs.existsSync(absoluteTargetFilePath)) {
        throw new Error(`Target file not found: ${absoluteTargetFilePath}`);
    }
    const gitHistory = await getGitHistory(context, repoPath, filePath);
    const hashToCommitInfo = new Map<string, CommitData>();

    for (const commit of gitHistory.commits) {
        hashToCommitInfo.set(commit.commitHash, commit);
    }
    const relativeTargetFilePath = path.relative(repoPath, absoluteTargetFilePath);

    // Step 2: Get the commit history for the main file with --follow to track renames
    const logArgs = ['log', '--reverse', '--follow', '--pretty=format:%H%x09%an%x09%ad%x09%s', '--', relativeTargetFilePath];
    let logData: string;

    try {
        logData = await git.raw(logArgs);
        log(`Retrieved git log data successfully.`, LogLevel.INFO);
    } catch (error) {
        throw new Error(`Failed to retrieve git log for ${filePath}: ${(error as Error).message}`);
    }

    const logLines = logData.split('\n').filter(line => line.trim() !== '');
    log(`Processing ${logLines.length} commits from git log.`, LogLevel.INFO);

    const allCommitsMap: Map<string, CommitData> = new Map();

    for (const line of logLines) {
        const [commitHash, authorName, dateStr, ...commitMsgParts] = line.split('\t');
        const commitData = hashToCommitInfo.get(commitHash);
        if (commitData && (commitData.panelChats.length > 0 || commitData.inlineChats.length > 0)) {
            allCommitsMap.set(commitHash, commitData);
        }
    }
    return {
        commits: Array.from(allCommitsMap.values()),
        added: null,
        uncommitted: null
    };
}

/**
 * Maps message IDs to their respective commit information.
 * @param context - The VSCode extension context.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the target file within the repository.
 * @returns A Promise resolving to a Map where keys are message IDs and values are CommitData.
 */
export async function getIdToCommitInfo(context: vscode.ExtensionContext, repoPath: string, filePath: string): Promise<Map<string, CommitData>> {
    const gitHistory = await getGitHistory(context, repoPath, filePath);
    return getMessageFromGitHistory(gitHistory);
}

export function getMessageFromGitHistory(gitHistory: GitHistoryData): Map<string, CommitData> {
    const idToCommitInfo = new Map<string, CommitData>();

    for (const commit of gitHistory.commits) {
        for (const panelChat of commit.panelChats) {
            for (const message of panelChat.messages) {
                idToCommitInfo.set(message.id, commit);
            }
        }
    }

    return idToCommitInfo;
}

/**
 * Maps inline chat IDs to their respective commit information.
 * @param context - The VSCode extension context.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the target file within the repository.
 * @returns A Promise resolving to a Map where keys are inline chat IDs and values are CommitData.
 */
export async function getInlineChatIdToCommitInfo(context: vscode.ExtensionContext, repoPath: string, filePath: string): Promise<Map<string, CommitData>> {
    const gitHistory = await getGitHistory(context, repoPath, filePath);
    return getInlineChatFromGitHistory(gitHistory);
}

export function getInlineChatFromGitHistory(gitHistory: GitHistoryData): Map<string, CommitData> {
    const idToCommitInfo = new Map<string, CommitData>();

    for (const commit of gitHistory.commits) {
        for (const inlineChat of commit.inlineChats) {
            idToCommitInfo.set(inlineChat.inline_chat_id, commit);
        }
    }

    return idToCommitInfo;
}

