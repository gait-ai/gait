import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import simpleGit, { SimpleGit } from 'simple-git';
import { StashedState, PanelChat, isStashedState } from './types';
import { InlineChatInfo } from './inline';
import { readStashedState } from './stashedState'; // Ensure this uses gzip
import { execFile } from 'child_process';
import { promisify } from 'util';

const SCHEMA_VERSION = '1.0';

export type CommitData = {
    commitHash: string;
    date: Date;
    commitMessage: string;
    author: string;
    panelChats: PanelChat[]; // Updated from messages to panelChats
    inlineChats: InlineChatInfo[];
};

export type UncommittedData = {
    panelChats: PanelChat[]; // Updated from messages to panelChats
    inlineChats: InlineChatInfo[];
};

export type GitHistoryData = {
    commits: CommitData[];
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
                //console.log(message);
                break;
            case LogLevel.WARN:
                console.warn(message);
                break;
            case LogLevel.ERROR:
                console.error(message);
                break;
        }
    }
}

const execFileAsync = promisify(execFile);
const zlib = require('zlib');

/**
 * Executes a Git command and returns the output as a Buffer.
 * @param args - Array of Git command arguments.
 * @param repoPath - The path to the Git repository.
 * @returns A Promise resolving to a Buffer containing the command output.
 */
async function gitShowBuffer(args: string[], repoPath: string): Promise<Buffer> {
    try {
        const { stdout } = await execFileAsync('git', args, { cwd: repoPath, encoding: null });
        return Buffer.from(stdout); // 'stdout' is a Buffer when 'encoding' is set to null
    } catch (error) {
        throw new Error(`Git command failed: ${(error as Error).message}`);
    }
}

/**
 * Ensures that the 'deletedChats' object and its nested properties exist.
 * @param stashedState - The StashedState object to validate and initialize.
 * @param commitHash - The hash of the current commit (for logging purposes).
 */
function ensureDeletedChats(stashedState: StashedState, commitHash: string) {
    if (!stashedState.deletedChats) {
        stashedState.deletedChats = { deletedMessageIDs: [], deletedPanelChatIDs: [] };
        log(`'deletedChats' was undefined in commit ${commitHash}. Initialized with empty arrays.`, LogLevel.WARN);
    }

    if (!Array.isArray(stashedState.deletedChats.deletedPanelChatIDs)) {
        stashedState.deletedChats.deletedPanelChatIDs = [];
        log(`'deletedPanelChatIDs' was undefined or not an array in commit ${commitHash}. Initialized as empty array.`, LogLevel.WARN);
    }

    if (!Array.isArray(stashedState.deletedChats.deletedMessageIDs)) {
        stashedState.deletedChats.deletedMessageIDs = [];
        log(`'deletedMessageIDs' was undefined or not an array in commit ${commitHash}. Initialized as empty array.`, LogLevel.WARN);
    }
}

/**
 * Processes a single commit's stashedPanelChats.json.gz and extracts active PanelChats and Messages.
 * @param parsedContent - The parsed StashedState from the commit.
 * @param currentMessageIds - Set of active message IDs.
 * @param currentPanelChatIds - Set of active PanelChat IDs.
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

    console.log("Commit Hash: ", commitHash);
    ensureDeletedChats(parsedContent, commitHash);

    const deletedPanelChatIds = new Set(parsedContent.deletedChats.deletedPanelChatIDs);
    const deletedMessageIds = new Set(parsedContent.deletedChats.deletedMessageIDs);

    if (Array.isArray(parsedContent.inlineChats)) {
        for (const inlineChat of parsedContent.inlineChats) {
            const inlineChatId = inlineChat.inline_chat_id;
            if (!currentInlineChatIds.has(inlineChatId)) {
                continue;
            }
            commitData.inlineChats.push(inlineChat);
        }
    } else {
        //console.log("parsedContent.inlineChats", parsedContent.inlineChats);
    }

    for (const panelChat of parsedContent.panelChats) {
        const panelChatId = panelChat.id;

        // Skip deleted PanelChats
        if (deletedPanelChatIds.has(panelChatId)) {
            log(`PanelChat ID ${panelChatId} has been deleted in commit ${commitHash}. Excluding from processing.`, LogLevel.INFO);
            continue;
        }

        // Create or retrieve existing PanelChat in commitData
        let existingPanelChat = commitData.panelChats.find(pc => pc.id === panelChatId);
        if (!existingPanelChat) {
            existingPanelChat = {
                ai_editor: panelChat.ai_editor,
                id: panelChat.id,
                customTitle: panelChat.customTitle,
                parent_id: panelChat.parent_id,
                created_on: panelChat.created_on,
                messages: [],
                kv_store: {}
            };
            commitData.panelChats.push(existingPanelChat);
            log(`Initialized PanelChat ID ${panelChatId} in commit ${commitHash}.`, LogLevel.INFO);
        }

        for (const messageEntry of panelChat.messages) {
            const messageId = messageEntry.id;
            //console.log("Message ID: ", messageId);
            //console.log("Seen Message IDs: ", seenMessageIds);

            // Only include active and unseen messages
            if (currentMessageIds.has(messageId) && !seenMessageIds.has(messageId)) {
                existingPanelChat.messages.push(messageEntry);
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
 * Retrieves the Git history for a specific file, capturing PanelChats instead of flat messages.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the target file within the repository.
 * @returns A Promise resolving to GitHistoryData containing commit history and uncommitted changes.
 */
export async function getGitHistory(context: vscode.ExtensionContext, repoPath: string, filePath: string): Promise<GitHistoryData> {
    const git: SimpleGit = simpleGit(repoPath);


    log("Starting getGitHistory", LogLevel.INFO);

    // Ensure the file exists in the repository
    const absoluteFilePath = path.resolve(repoPath, filePath);
    if (!fs.existsSync(absoluteFilePath)) {
        throw new Error(`File not found: ${absoluteFilePath}`);
    }

    // Step 1: Read the current stashedPanelChats.json.gz to collect existing message and panelChat IDs
    let parsedCurrent: StashedState;
    const currentMessageIds: Set<string> = new Set();
    const currentPanelChatIds: Set<string> = new Set();

    try {
        parsedCurrent = readStashedState(context); // This now handles gzip decompression
        if (!isStashedState(parsedCurrent)) {
            throw new Error('Parsed content does not match StashedState structure.');
        }
        log(`Parsed current stashedPanelChats.json.gz successfully.`, LogLevel.INFO);
    } catch (error) {
        log(`Warning: Failed to parse current JSON content: ${(error as Error).message}`, LogLevel.WARN);
        // Initialize with default structure if parsing fails
        parsedCurrent = {
            panelChats: [],
            inlineChats: [],
            schemaVersion: SCHEMA_VERSION,
            deletedChats: { deletedMessageIDs: [], deletedPanelChatIDs: [] },
            kv_store: {}
        };
        log(`Initialized default stashedPanelChats.json.gz structure due to parsing failure.`, LogLevel.INFO);
    }

    // Ensure deletedChats exists
    if (!parsedCurrent.deletedChats) {
        parsedCurrent.deletedChats = { deletedMessageIDs: [], deletedPanelChatIDs: [] };
        log(`'deletedChats' was undefined. Initialized with empty arrays.`, LogLevel.WARN);
    }

    // Ensure deletedPanelChatIDs exists and is an array
    if (!Array.isArray(parsedCurrent.deletedChats.deletedPanelChatIDs)) {
        parsedCurrent.deletedChats.deletedPanelChatIDs = [];
        log(`'deletedPanelChatIDs' was undefined or not an array. Initialized as empty array.`, LogLevel.WARN);
    }

    // Ensure deletedMessageIDs exists and is an array
    if (!Array.isArray(parsedCurrent.deletedChats.deletedMessageIDs)) {
        parsedCurrent.deletedChats.deletedMessageIDs = [];
        log(`'deletedMessageIDs' was undefined or not an array. Initialized as empty array.`, LogLevel.WARN);
    }

    const deletedPanelChatIds = new Set(parsedCurrent.deletedChats.deletedPanelChatIDs);
    const deletedMessageIds = new Set(parsedCurrent.deletedChats.deletedMessageIDs);

    // Collect all current message and panelChat IDs excluding deleted ones
    for (const panelChat of parsedCurrent.panelChats) {
        if (!deletedPanelChatIds.has(panelChat.id)) {
            currentPanelChatIds.add(panelChat.id);
            for (const message of panelChat.messages) {
                if (!deletedMessageIds.has(message.id)) {
                    currentMessageIds.add(message.id);
                }
            }
        }
    }

    log(`Collected ${currentPanelChatIds.size} active PanelChat IDs and ${currentMessageIds.size} active Message IDs.`, LogLevel.INFO);

    // Step 2: Get the commit history for the file with --follow to track renames
    // '--reverse' ensures commits are ordered from oldest to newest
    const logArgs = ['log', '--reverse', '--follow', '--pretty=format:%H%x09%an%x09%ad%x09%s', '--', filePath];

    let logData: string;
    try {
        // Use simple-git to get the log data
        logData = await git.raw(logArgs);
        log(`Retrieved git log data successfully.`, LogLevel.INFO);
    } catch (error) {
        throw new Error(`Failed to retrieve git log: ${(error as Error).message}`);
    }

    const logLines = logData.split('\n').filter(line => line.trim() !== '');
    log(`Processing ${logLines.length} commits from git log.`, LogLevel.INFO);

    const allCommitsMap: Map<string, CommitData> = new Map();
    const seenMessageIds: Set<string> = new Set();

    for (const line of logLines) {
        const [commitHash, authorName, dateStr, ...commitMsgParts] = line.split('\t');
        const commitMessage = commitMsgParts.join('\t');

        // Get the file content at this commit using child_process
        let fileBuffer: Buffer;
        let decompressedBuffer: Buffer;
        try {
            fileBuffer = await gitShowBuffer(['show', `${commitHash}:${filePath}`], repoPath);
            decompressedBuffer = zlib.gunzipSync(fileBuffer);
            log(`Retrieved and decompressed file content for commit ${commitHash}.`, LogLevel.INFO);
        } catch (error) {
            log(`Warning: Could not retrieve or decompress file ${filePath} at commit ${commitHash}.`, LogLevel.WARN);
            log(`Error: ${(error as Error).message}`, LogLevel.WARN);
            continue; // Skip this commit
        }

        // Decompress and parse JSON
        let parsedContent: StashedState;
        try {
            const jsonString = decompressedBuffer.toString('utf-8');
            parsedContent = JSON.parse(jsonString);
            if (!isStashedState(parsedContent)) {
                throw new Error('Parsed content does not match StashedState structure.');
            }
            log(`Parsed stashedPanelChats.json.gz for commit ${commitHash} successfully.`, LogLevel.INFO);
        } catch (error) {
            log(`Warning: Failed to parse JSON for commit ${commitHash}: ${(error as Error).message}`, LogLevel.WARN);
            log(`Content Decompressed Buffer: ${decompressedBuffer}`, LogLevel.WARN);
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
                inlineChats: [],
            };
            allCommitsMap.set(commitHash, commitData);
            log(`Initialized CommitData for commit ${commitHash}.`, LogLevel.INFO);
        }

        // Process the commit's panelChats
        processCommit(parsedContent, currentMessageIds, currentPanelChatIds, seenMessageIds, commitData, commitHash);
    }

    // Convert the map to an array
    let allCommits: CommitData[] = Array.from(allCommitsMap.values());

    // **New Addition:** Filter out commits with empty panelChats
    allCommits = allCommits.filter(commit => commit.panelChats.some(pc => pc.messages.length > 0));
    log(`Filtered commits to exclude empty ones. Remaining commits count: ${allCommits.length}`, LogLevel.INFO);
    // Step 3: Check for uncommitted changes
    let status;
    try {
        status = await git.status();
        log(`Retrieved git status successfully.`, LogLevel.INFO);
    } catch (error) {
        throw new Error(`Failed to retrieve git status: ${(error as Error).message}`);
    }

    let uncommitted: UncommittedData | null = null;
    if (
        status.modified.includes(filePath) ||
        status.not_added.includes(filePath) ||
        status.created.includes(filePath)
    ) {
        // Get the current (uncommitted) file content
        log("stashedPanelChats.json.gz is modified", LogLevel.INFO);
        let currentUncommittedContent: StashedState;
        try {
            currentUncommittedContent = readStashedState(context); // Use the updated readStashedState
            log(`Successfully read uncommitted stashedPanelChats.json.gz.`, LogLevel.INFO);
        } catch (error) {
            log(`Warning: Failed to read current file content: ${(error as Error).message}`, LogLevel.WARN);
            currentUncommittedContent = {
                panelChats: [],
                inlineChats: [],
                schemaVersion: SCHEMA_VERSION,
                deletedChats: { deletedMessageIDs: [], deletedPanelChatIDs: [] },
                kv_store: {}
            }; // Default to empty StashedState
            log(`Initialized default uncommitted stashedPanelChats.json.gz structure due to reading failure.`, LogLevel.INFO);
        }

        // Ensure deletedChats exists
        if (!currentUncommittedContent.deletedChats) {
            currentUncommittedContent.deletedChats = { deletedMessageIDs: [], deletedPanelChatIDs: [] };
            log(`'deletedChats' was undefined in uncommitted changes. Initialized with empty arrays.`, LogLevel.WARN);
        }

        // Ensure deletedPanelChatIDs exists and is an array
        if (!Array.isArray(currentUncommittedContent.deletedChats.deletedPanelChatIDs)) {
            currentUncommittedContent.deletedChats.deletedPanelChatIDs = [];
            log(`'deletedPanelChatIDs' was undefined or not an array in uncommitted changes. Initialized as empty array.`, LogLevel.WARN);
        }

        // Ensure deletedMessageIDs exists and is an array
        if (!Array.isArray(currentUncommittedContent.deletedChats.deletedMessageIDs)) {
            currentUncommittedContent.deletedChats.deletedMessageIDs = [];
            log(`'deletedMessageIDs' was undefined or not an array in uncommitted changes. Initialized as empty array.`, LogLevel.WARN);
        }

        const uncommittedDeletedPanelChatIds = new Set(currentUncommittedContent.deletedChats.deletedPanelChatIDs);
        const uncommittedDeletedMessageIds = new Set(currentUncommittedContent.deletedChats.deletedMessageIDs);

        // Aggregate all panelChats from uncommitted changes, excluding deleted ones
        const allCurrentPanelChats: PanelChat[] = currentUncommittedContent.panelChats.filter(pc =>
            !uncommittedDeletedPanelChatIds.has(pc.id)
        ).map(pc => {
            const filteredMessages = pc.messages.filter(msg =>
                !uncommittedDeletedMessageIds.has(msg.id) && currentMessageIds.has(msg.id) && !seenMessageIds.has(msg.id)
            );
            return {
                ...pc,
                messages: filteredMessages
            };
        }).filter(pc => pc.messages.length > 0);

        const allCurrentInlineChats: InlineChatInfo[] = currentUncommittedContent.inlineChats;

        log(`Aggregated ${allCurrentPanelChats.length} uncommitted PanelChats.`, LogLevel.INFO);

        if (allCurrentPanelChats.length > 0) {
            uncommitted = {
                panelChats: allCurrentPanelChats,
                inlineChats: allCurrentInlineChats
            };
            log(`Found ${allCurrentPanelChats.length} uncommitted new panelChats.`, LogLevel.INFO);
        } else {
            log("No uncommitted new panelChats found.", LogLevel.INFO);
        }
    }

    log("Returning commits and uncommitted data.", LogLevel.INFO);
    log(`Total Commits: ${allCommits.length}`, LogLevel.INFO);
    if (uncommitted) {
        log(`Uncommitted PanelChats: ${uncommitted.panelChats.length}`, LogLevel.INFO);
    } else {
        log(`No uncommitted changes.`, LogLevel.INFO);
    }
    return {
        commits: allCommits,
        uncommitted,
    };
}


export async function getGitHistoryThatTouchesFile(context: vscode.ExtensionContext, repoPath: string, filePath: string, targetFilePath: string): Promise<GitHistoryData> {
    const git: SimpleGit = simpleGit(repoPath);

    // Ensure both files exist in the repository
    const absoluteFilePath = path.resolve(repoPath, filePath);
    const absoluteTargetFilePath = path.resolve(repoPath, targetFilePath);
    if (!fs.existsSync(absoluteFilePath)) {
        throw new Error(`File not found: ${absoluteFilePath}`);
    }
    if (!fs.existsSync(absoluteTargetFilePath)) {
        throw new Error(`Target file not found: ${absoluteTargetFilePath}`);
    }

    // Step 1: Read the current stashedPanelChats.json.gz to collect existing message and panelChat IDs
    let parsedCurrent: StashedState;
    const currentMessageIds: Set<string> = new Set();
    const currentPanelChatIds: Set<string> = new Set();

    try {
        parsedCurrent = readStashedState(context); // This now handles gzip decompression
        if (!isStashedState(parsedCurrent)) {
            throw new Error('Parsed content does not match StashedState structure.');
        }
        log(`Parsed current stashedPanelChats.json.gz successfully.`, LogLevel.INFO);
    } catch (error) {
        log(`Warning: Failed to parse current JSON content: ${(error as Error).message}`, LogLevel.WARN);
        // Initialize with default structure if parsing fails
        parsedCurrent = {
            panelChats: [],
            inlineChats: [],
            schemaVersion: SCHEMA_VERSION,
            deletedChats: { deletedMessageIDs: [], deletedPanelChatIDs: [] },
            kv_store: {}
        };
        log(`Initialized default stashedPanelChats.json.gz structure due to parsing failure.`, LogLevel.INFO);
    }

    const deletedPanelChatIds = new Set(parsedCurrent.deletedChats.deletedPanelChatIDs);
    const deletedMessageIds = new Set(parsedCurrent.deletedChats.deletedMessageIDs);

    // Collect all current message and panelChat IDs excluding deleted ones
    for (const panelChat of parsedCurrent.panelChats) {
        if (!deletedPanelChatIds.has(panelChat.id)) {
            currentPanelChatIds.add(panelChat.id);
            for (const message of panelChat.messages) {
                if (!deletedMessageIds.has(message.id)) {
                    currentMessageIds.add(message.id);
                }
            }
        }
    }

    log(`Collected ${currentPanelChatIds.size} active PanelChat IDs and ${currentMessageIds.size} active Message IDs.`, LogLevel.INFO);

    // Step 2: Get the commit history for the main file with --follow to track renames
    // '--reverse' ensures commits are ordered from oldest to newest
    const logArgs = ['log', '--reverse', '--follow', '--pretty=format:%H%x09%an%x09%ad%x09%s', '--', filePath];

    let logData: string;
    try {
        logData = await git.raw(logArgs);
        log(`Retrieved git log data successfully.`, LogLevel.INFO);
    } catch (error) {
        throw new Error(`Failed to retrieve git log for ${filePath}: ${(error as Error).message}`);
    }

    const logLines = logData.split('\n').filter(line => line.trim() !== '');
    //console.log(`Processing ${logLines.length} commits from git log.`);

    const allCommitsMap: Map<string, CommitData> = new Map();
    const seenMessageIds: Set<string> = new Set();

    for (const line of logLines) {
        //console.log("Processing Line: ", line);
        const [commitHash, authorName, dateStr, ...commitMsgParts] = line.split('\t');
        const commitMessage = commitMsgParts.join('\t');

        // Skip commits that are solely for deletions
        if (commitMessage.startsWith('Delete message with ID') || commitMessage.startsWith('Delete PanelChat with ID')) {
            //console.log(`Skipping deletion commit ${commitHash}: ${commitMessage}`);
            continue;
        }

        // Check if this commit also modifies the targetFilePath
        let modifiesTargetFile = false;
        try {
            const filesChanged = await git.raw(['diff-tree', '--no-commit-id', '--name-only', '-r', commitHash]);
            const files = filesChanged.split('\n').map(f => f.trim());
            if (files.includes(targetFilePath)) {
                modifiesTargetFile = true;
                console.log(`Commit ${commitHash} modifies target file ${targetFilePath}.`);
            } else {
                console.log(`Commit ${commitHash} does not modify target file ${targetFilePath}. Skipping.`);
            }
        } catch (error) {
            console.warn(`Warning: Failed to retrieve files changed in commit ${commitHash}: ${(error as Error).message}`);
            continue; // Skip this commit
        }

        if (!modifiesTargetFile) {
            // parsedContent.panelChats.forEach(pc => pc.messages.forEach(
            //     msg => seenMessageIds.add(msg.id)));
            continue; 
        }

        // Get the file content at this commit
        let fileBuffer: Buffer;
        let decompressedBuffer: Buffer;
        try {
            fileBuffer = await gitShowBuffer(['show', `${commitHash}:${filePath}`], repoPath);
            decompressedBuffer = zlib.gunzipSync(fileBuffer);
            log(`Retrieved and decompressed file content for commit ${commitHash}.`, LogLevel.INFO);
        } catch (error) {
            log(`Warning: Could not retrieve or decompress file ${filePath} at commit ${commitHash}.`, LogLevel.WARN);
            log(`Error: ${(error as Error).message}`, LogLevel.WARN);
            continue; // Skip this commit
        }

        // Decompress and parse JSON
        let parsedContent: StashedState;
        try {
            const jsonString = decompressedBuffer.toString('utf-8');
            parsedContent = JSON.parse(jsonString);
            if (!isStashedState(parsedContent)) {
                throw new Error('Parsed content does not match StashedState structure.');
            }
            log(`Parsed stashedPanelChats.json.gz for commit ${commitHash} successfully.`, LogLevel.INFO);
        } catch (error) {
            log(`Warning: Failed to parse JSON for commit ${commitHash}: ${(error as Error).message}`, LogLevel.WARN);
            log(`Content Decompressed Buffer: ${decompressedBuffer}`, LogLevel.WARN);
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
                inlineChats: [],
            };
            allCommitsMap.set(commitHash, commitData);
            //console.log(`Initialized CommitData for commit ${commitHash}.`);
        }

        // Process the commit's panelChats
        processCommit(parsedContent, currentMessageIds, currentPanelChatIds, seenMessageIds, commitData, commitHash);
    }

    // Convert the map to an array
    let allCommits: CommitData[] = Array.from(allCommitsMap.values());

    // **New Addition:** Filter out commits with empty panelChats
    allCommits = allCommits.filter(commit => commit.panelChats.some(pc => pc.messages.length > 0));

    // Step 3: Check for uncommitted changes
    let status;
    try {
        status = await git.status();
        //console.log(`Retrieved git status successfully.`);
    } catch (error) {
        throw new Error(`Failed to retrieve git status: ${(error as Error).message}`);
    }

    let uncommitted: UncommittedData | null = null;
    //console.log("Checking uncommitted changes");
    if (
        status.modified.includes(targetFilePath) ||
        status.not_added.includes(targetFilePath) ||
        status.created.includes(targetFilePath)
    ) {
        // Get the current (uncommitted) file content
        //console.log("stashedPanelChats.json.gz is modified");
        let currentUncommittedContent: StashedState;
        try {
            currentUncommittedContent = readStashedState(context); // Use the updated readStashedState
            //console.log(`Successfully read uncommitted stashedPanelChats.json.gz.`);
        } catch (error) {
            console.warn(`Warning: Failed to read current file content: ${(error as Error).message}`);
            currentUncommittedContent = {
                panelChats: [],
                inlineChats: [],
                schemaVersion: SCHEMA_VERSION,
                deletedChats: { deletedMessageIDs: [], deletedPanelChatIDs: [] },
                kv_store: {}
            }; // Default to empty StashedState
            //console.log(`Initialized default uncommitted stashedPanelChats.json.gz structure due to reading failure.`);
        }

        // Ensure deletedChats exists
        if (!currentUncommittedContent.deletedChats) {
            currentUncommittedContent.deletedChats = { deletedMessageIDs: [], deletedPanelChatIDs: [] };
            log(`'deletedChats' was undefined in uncommitted changes. Initialized with empty arrays.`, LogLevel.WARN);
        }

        // Ensure deletedPanelChatIDs exists and is an array
        if (!Array.isArray(currentUncommittedContent.deletedChats.deletedPanelChatIDs)) {
            currentUncommittedContent.deletedChats.deletedPanelChatIDs = [];
            log(`'deletedPanelChatIDs' was undefined or not an array in uncommitted changes. Initialized as empty array.`, LogLevel.WARN);
        }

        // Ensure deletedMessageIDs exists and is an array
        if (!Array.isArray(currentUncommittedContent.deletedChats.deletedMessageIDs)) {
            currentUncommittedContent.deletedChats.deletedMessageIDs = [];
            log(`'deletedMessageIDs' was undefined or not an array in uncommitted changes. Initialized as empty array.`, LogLevel.WARN);
        }

        const uncommittedDeletedPanelChatIds = new Set(currentUncommittedContent.deletedChats.deletedPanelChatIDs);
        const uncommittedDeletedMessageIds = new Set(currentUncommittedContent.deletedChats.deletedMessageIDs);

        // Aggregate all panelChats from uncommitted changes, excluding deleted ones
        const allCurrentPanelChats: PanelChat[] = currentUncommittedContent.panelChats.filter(pc =>
            !uncommittedDeletedPanelChatIds.has(pc.id)
        ).map(pc => {
            const filteredMessages = pc.messages.filter(msg =>
                !uncommittedDeletedMessageIds.has(msg.id) && currentMessageIds.has(msg.id) && !seenMessageIds.has(msg.id)
            );
            return {
                ...pc,
                messages: filteredMessages
            };
        }).filter(pc => pc.messages.length > 0);

        const allCurrentInlineChats: InlineChatInfo[] = currentUncommittedContent.inlineChats;

        //console.log(`Aggregated ${allCurrentPanelChats.length} uncommitted PanelChats.`);

        if (allCurrentPanelChats.length > 0) {
            uncommitted = {
                panelChats: allCurrentPanelChats,
                inlineChats: allCurrentInlineChats
            };
            //console.log(`Found ${allCurrentPanelChats.length} uncommitted new panelChats.`);
        } else {
            //console.log("No uncommitted new panelChats found.");
        }
    }

    return {
        commits: allCommits,
        uncommitted,
    };
}

/**
 * Maps message and inline chat IDs to their respective commit information.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the target file within the repository.
 * @returns A Promise resolving to a Map where keys are IDs and values are CommitData.
 */
export async function getIdToCommitInfo(context: vscode.ExtensionContext, repoPath: string, filePath: string): Promise<Map<string, CommitData>> {
    const gitHistory  = await getGitHistory(context, repoPath, filePath);
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

/**
 * Maps inline chat IDs to their respective commit information.
 * @param repoPath - The path to the Git repository.
 * @param filePath - The relative path to the target file within the repository.
 * @returns A Promise resolving to a Map where keys are inline chat IDs and values are CommitData.
 */
export async function getInlineChatIdToCommitInfo(context: vscode.ExtensionContext, repoPath: string, filePath: string): Promise<Map<string, CommitData>> {
    const gitHistory  = await getGitHistory(context, repoPath, filePath);
    const idToCommitInfo = new Map<string, CommitData>();
    for (const commit of gitHistory.commits) {
      for (const inlineChat of commit.inlineChats) { // Updated to iterate through inlineChats
        idToCommitInfo.set(inlineChat.inline_chat_id, commit);
      }
    }
    return idToCommitInfo;
}
