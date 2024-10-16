import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as Inline from './inline';
import * as InlineDecoration from './filedecoration';
import { PanelViewProvider } from './panelview';
import { monitorPanelChatAsync } from './panelChats';
import * as VSCodeReader from './vscode/vscodeReader';
import { panelChatsToMarkdown } from './markdown';
import * as CursorReader from './cursor/cursorReader';
import { checkTool, TOOL } from './ide';
import { AIChangeMetadata, PanelChat, PanelChatMode, StashedState, StateReader } from './types';
import { generateKeybindings } from './keybind';
import {diffLines} from 'diff';
import { getRelativePath } from './utils';
import { readStashedStateFromFile, writeStashedState, readStashedState, removePanelChatFromStashedState } from './stashedState';
import posthog from 'posthog-js';
import { identifyRepo, identifyUser } from './identify_user';
import simpleGit from 'simple-git';
import { addGaitSearchExclusion } from './setup/exclude_search';
import { getGitHistory, GitHistoryData } from './panelgit';
import { STASHED_GAIT_STATE_FILE_NAME } from './constants';
import { removeGait } from './remove_gait';
import { initializeGait } from './initialize_gait';

posthog.init('phc_vosMtvFFxCN470e8uHGDYCD6YuuSRSoFoZeLuciujry',
    {
        api_host: 'https://us.i.posthog.com',
        person_profiles: 'always' // or 'always' to create profiles for anonymous users as well
    }
);

const GAIT_FOLDER_NAME = '.gait';

let disposibleDecorations: vscode.Disposable[] = [];
let decorationsActive = false;
let timeOfLastDecorationChange = Date.now();

let isRedecorating = false;
let changeQueue: { cursor_position: vscode.Position, 
    document_uri: string, 
    changes: vscode.TextDocumentContentChangeEvent[], 
    timestamp: number, 
    document_content: string | null }[] = [];
let triggerAcceptCount = 0;
let lastInlineChatStart: Inline.InlineStartInfo | null = null;
let lastPanelChatMessageNum: number = 0;

let fileState: { [key: string]: string } = {};
let gitHistory: GitHistoryData | null = null;
let hoverDecorationTypes: vscode.Disposable[] = [];

function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    return (...args: Parameters<F>): void => {
        if (timeout !== null) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => func(...args), waitFor);
    };
}


function getFileContent(file_path: string): string {
    if (fileState[file_path]) {
        //console.log("File content from fileState:", fileState[file_path]);
        return fileState[file_path];
    } else {
        // Read the file content from the file system
        try {
            //console.log("Reading file from file system:", file_path);
            return fs.readFileSync(file_path, 'utf8');
        } catch (error) {
            console.error(`Error reading file ${file_path}: ${error}`);
            return '';
        }
    }
}
/**
 * Handles file changes to detect AI-generated changes.
 */
async function handleFileChange(event: vscode.TextDocumentChangeEvent) {
    const changes = event.contentChanges;
    
    const editor = vscode.window.activeTextEditor;
    // Check if the file is in the workspace directory
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        // vscode.window.showInformationMessage('Open a workspace to use gait!');
        return; // No workspace folder open
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;
    const filePath = event.document.uri.fsPath;


    if (!filePath.startsWith(workspacePath)) {
        // console.log(`File ${filePath} is not in the workspace directory`);
        return; // File is not in the workspace directory
    }
    if (!event.document.fileName || event.reason || !editor || changes.length === 0 || event.document.fileName.includes(path.join(GAIT_FOLDER_NAME)) || event.document.fileName.includes("rendererLog")){
        return;
    }

    const currentCursorPosition = editor.selection.active;
    const lastCursorPosition = changeQueue.length > 0 ? changeQueue[changeQueue.length - 1].cursor_position : null;
    const isCursorMoved = lastCursorPosition && !lastCursorPosition.isEqual(currentCursorPosition);

    // Check if changes are AI-generated
    const isAIChange = changes.some(change => change.text.length > 5 && !isCursorMoved); // Example threshold for AI-generated change
    // Check if the change is not from clipboard paste
    const clipboardContent = await vscode.env.clipboard.readText();
    const isClipboardPaste = changes.some(change => change.text === clipboardContent);
    if (!isClipboardPaste && isAIChange) {
        const timestamp = Date.now();
        changeQueue.push({
            cursor_position: currentCursorPosition,
            document_uri: getRelativePath(event.document),
            changes: [...changes],
            timestamp,
            document_content: getFileContent(event.document.uri.fsPath),
        });
    }
    const file_path: string = getRelativePath(event.document);
    fileState[file_path] = event.document.getText();
}

async function triggerAccept(stateReader: StateReader, context: vscode.ExtensionContext) {
    // Check if there are changes in the queue
    if (changeQueue.length > 0) {
        const lastChange = changeQueue[changeQueue.length - 1];
        const currentTime = Date.now();
        if (currentTime - lastChange.timestamp > 1500) {
            
            // Print out the changeQueue
            // Get the file content for each changed file
            const changedFiles = new Set(changeQueue.map(change => change.document_uri));

            const beforeFileContents: { [key: string]: string } = {};
            changeQueue.forEach(change => {
                if (!beforeFileContents[change.document_uri]) {
                    beforeFileContents[change.document_uri] = change.document_content || '';
                }
            });
            changeQueue = [];
            // Get the current file content for each changed file
            const afterFileContents: { [key: string]: string } = {};
            // Wait for 1 second
            await new Promise(resolve => setTimeout(resolve, 1000));
            changedFiles.forEach(filePath => {
                const document = vscode.workspace.textDocuments.find(doc => getRelativePath(doc) === filePath);
                if (document) {
                    afterFileContents[filePath] = document.getText();
                } else {
                    console.error(`Document not found for file: ${filePath}`);
                    afterFileContents[filePath] = '';
                }
            });
            // Calculate file diffs
            const fileDiffs: Inline.FileDiff[] = [];
            changedFiles.forEach(filePath => {
                try {
                    const before = beforeFileContents[filePath];
                    const after = afterFileContents[filePath];
                    const diffs = diffLines(before, after);
                    fileDiffs.push({
                        file_path: filePath,
                        diffs: diffs,
                    });
                } catch (error) {
                    console.error(`Error processing file ${filePath}: ${error}`);
                }
            });
            // Extract the position where changes start if only one file is modified
            let changeStartPosition: vscode.Position | undefined;
            if (fileDiffs.length === 1) {
                const diff = fileDiffs[0];
                const firstAddedChange = diff.diffs.find(change => change.added);
                if (firstAddedChange) {
                    const linesBefore = diff.diffs
                        .slice(0, diff.diffs.indexOf(firstAddedChange))
                        .reduce((sum, change) => sum + (change.count || 0), 0);
                    changeStartPosition = new vscode.Position(linesBefore, 0);
                }
            }
            let inlineChatStart: Inline.InlineStartInfo | undefined = undefined; 
            const inlineData:Inline.InlineStartInfo | null = context.workspaceState.get('lastInlineChatStart')?? lastInlineChatStart;
            if (inlineData && fileDiffs.length === 1 && changeStartPosition) {
                if (inlineData.fileName === fileDiffs[0].file_path &&
                    currentTime - new Date(inlineData.startTimestamp).getTime() < 60000 &&
                    changeStartPosition.line >= inlineData.startSelection.line &&
                    changeStartPosition.line <= inlineData.startSelection.line + 10) {
                    inlineChatStart = inlineData;
                }
                context.workspaceState.update('lastInlineChatStart', null);
                lastInlineChatStart = null;
            }
            
            const metadata: AIChangeMetadata = {
                changeStartPosition: changeStartPosition,
                inlineChatStartInfo: inlineChatStart,
            };
            stateReader.pushFileDiffs(fileDiffs, metadata);
        }
    }
}

/**
 * Function to redecorate the editor with debounce.
 */
const debouncedRedecorate = debounce((context: vscode.ExtensionContext) => {
    isRedecorating = true;

    if (disposibleDecorations) {
        disposibleDecorations.forEach(decoration => decoration.dispose());
    }

    disposibleDecorations = InlineDecoration.decorateActive(context, gitHistory, decorationsActive);

    isRedecorating = false;
}, 300); // 300ms debounce time


/**
 * Activates the extension.
 */
export function activate(context: vscode.ExtensionContext) {
   const firstTime = context.globalState.get('firstTime', true);

    if (firstTime) {
        // Mark that it's no longer the first time
        context.globalState.update('firstTime', false);
        posthog.capture('user_download');

        // Open the welcome markdown file
        const welcomeFile = vscode.Uri.joinPath(context.extensionUri, 'resources', 'welcome.md');
        vscode.commands.executeCommand('markdown.showPreview', welcomeFile);
        setTimeout(() => {
            vscode.window.showInformationMessage('View your codebase stats', 'View Stats')
                .then((selection: string | undefined) => {
                    if (selection === 'View Your Stats!') {
                        vscode.env.openExternal(vscode.Uri.parse('https://getgait.com/auth'));
                    }
                });
        }, 120000); // 2 minutes
    }

    const initializeGaitCommand = vscode.commands.registerCommand('gait.initializeGait', async () => {
        context.workspaceState.update('usingGait', 'true');
        initializeGait();
        vscode.commands.executeCommand('workbench.action.reloadWindow');
    });

    context.subscriptions.push(
        initializeGaitCommand
    );

    const usingGait = context.workspaceState.get('usingGait', 'false');
    if (usingGait === 'false') {
        // Register dummy commands
        const dummyCommands = [
            'gait.startInlineChat',
            'gait.openFileWithContent',
            'gait.removeInlineChat',
            'gait.exportPanelChatsToMarkdown',
            'gait.removePanelChat',
            'gait.toggleHover',
            'gait.excludeSearch',
            'gait.showIndividualPanelChat'
        ];

        dummyCommands.forEach(commandId => {
            const disposable = vscode.commands.registerCommand(commandId, () => {
                vscode.window.showInformationMessage('Please activate gait in the gait panel to use this command.');
            });
            context.subscriptions.push(disposable);
        });

        return;
    }
    
    const tool: TOOL = checkTool();
    // Set panelChatMode in extension workspaceStorage
    const panelChatMode = "OnlyMatchedChats";
    context.workspaceState.update('panelChatMode', panelChatMode);

    identifyUser();
    posthog.capture('activate_extension', {
        tool: tool,
    });



    generateKeybindings(context, tool);

    const startInlineCommand = tool === "Cursor" ? "aipopup.action.modal.generate" : "inlineChat.start";
    const startPanelCommand = tool === "Cursor" ? "aichat.newchataction" : "workbench.action.chat.openInSidebar";

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        // vscode.window.showInformationMessage('Open a workspace to use gait!');
        return;
    }

    if((vscode.workspace.workspaceFolders?.length ?? 0) > 1){
        vscode.window.showInformationMessage('gait currently only supports single folder workspaces. Please close other folders.');
        return;
    }

    identifyRepo(context);
    const stateReader: StateReader = tool === 'Cursor' ? new CursorReader.CursorReader(context) : new VSCodeReader.VSCodeReader(context);

    writeStashedState(context, readStashedStateFromFile());
    context.workspaceState.update('stashedState', readStashedStateFromFile());
    setTimeout(async () => {
        monitorPanelChatAsync(stateReader, context);
        const filePath = `.gait/${STASHED_GAIT_STATE_FILE_NAME}`;
        gitHistory = await getGitHistory(context, workspaceFolder.uri.fsPath, filePath);
    }, 3000); // Delay to ensure initial setup

    const provider = new PanelViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PanelViewProvider.viewType, provider, { webviewOptions: { retainContextWhenHidden: true } })
    );

    //console.log('WebviewViewProvider registered for', PanelViewProvider.viewType);

    const inlineChatStartOverride = vscode.commands.registerCommand('gait.startInlineChat', () => {
        // Display an information message
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const selection = editor.selection;
            const inlineStartInfo: Inline.InlineStartInfo = {
                fileName: vscode.workspace.asRelativePath(document.uri),
                content: document.getText(),
                lineCount: document.lineCount,
                startTimestamp: new Date().toISOString(),
                startSelection: selection.start,
                endSelection: selection.end,
                selectionContent: document.getText(selection),
                parent_inline_chat_id: null,
            };
            stateReader.startInline(inlineStartInfo).catch((error) => {
                vscode.window.showErrorMessage(`Failed to initialize extension: ${error instanceof Error ? error.message : 'Unknown error'}`);
            });
            context.workspaceState.update('lastInlineChatStart', inlineStartInfo);
            lastInlineChatStart = inlineStartInfo;
        }
        vscode.commands.executeCommand(startInlineCommand);
    });

    const openFileWithContentCommand = vscode.commands.registerCommand('gait.openFileWithContent', async (args) => {
        try {
            // Create a new untitled document
            vscode.workspace.openTextDocument({
                content: args.content,
                language: args.languageId // You can change this to match the content type
            }).then((document) => vscode.window.showTextDocument(document, {
                preview: false, // This will open the document in preview mode
            }));

            vscode.window.showInformationMessage(`Opened new file: ${args.title}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Register the deleteInlineChat command
    const deleteInlineChatCommand = vscode.commands.registerCommand('gait.removeInlineChat', (args) => {
        //console.log("Removing inline chat", args);
        Inline.removeInlineChat(context, args.inline_chat_id);
        vscode.window.showInformationMessage("removed inline chat.");
        debouncedRedecorate(context);
    });

    // Register command to convert PanelChats to markdown and open in a new file
    const exportPanelChatsToMarkdownCommand = vscode.commands.registerCommand('gait.exportPanelChatsToMarkdown', async (args) => {
        try {
            const  panelChatId  = args.data;
            const continue_chat = args.continue_chat;

            // Retrieve the current panel chats from workspace state
            const currentPanelChats: PanelChat[] | undefined = context.workspaceState.get('currentPanelChats');
            if (!currentPanelChats) {
                throw new Error('No panel chats found in workspace state');
            }
            // Retrieve the stashed state from workspace state
            const stashedState: StashedState = readStashedState(context);

            const allPanelChats = [
                ...(currentPanelChats || []),
                ...stashedState.panelChats
            ];
            // Find the specific panel chat
            const panelChat = allPanelChats.find(chat => chat.id === panelChatId);
            if (!panelChat) {
                throw new Error(`Panel chat with ID ${panelChatId} not found`);
            }

            // Create the markdown data
            const markdownData = [{
                commit: args.commitInfo,
                panelChat: panelChat
            }];

            const markdownContent = panelChatsToMarkdown(markdownData, continue_chat);
            const filePath = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', 'gait_context.md');
            fs.writeFileSync(filePath, markdownContent, 'utf8');
            if (continue_chat){
                posthog.capture('continue_chat');
                await vscode.workspace.openTextDocument(filePath);
                await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(filePath));
                await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup');
            } else {
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), { viewColumn: vscode.ViewColumn.Beside });
            }
            await vscode.commands.executeCommand(startPanelCommand);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export panel chats: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const removePanelChatCommand = vscode.commands.registerCommand('gait.removePanelChat', (args) => {
        const stashedState = readStashedState(context);
        stashedState.deletedChats.deletedPanelChatIDs.push(args.panelChatId);        
        writeStashedState(context, stashedState);
        vscode.window.showInformationMessage("Deleted panel chat.");
        debouncedRedecorate(context);
    });

    const toggleHoverCommand = vscode.commands.registerCommand('gait.toggleHover', () => {
        decorationsActive = !decorationsActive;
        if (decorationsActive) {
            posthog.capture('activate_decorations', {
                time_deactivated: Date.now() - timeOfLastDecorationChange,
            });
            timeOfLastDecorationChange = Date.now();
            debouncedRedecorate(context);
            vscode.window.showInformationMessage('gait hover activated.');
        } else {
            posthog.capture('deactivate_decorations');
            if (disposibleDecorations) {
                timeOfLastDecorationChange = Date.now();
                posthog.capture('deactivate_decorations', {
                    time_activated: Date.now() - timeOfLastDecorationChange,
                });
                disposibleDecorations.forEach(decoration => decoration.dispose());
                disposibleDecorations = [];
            }
            vscode.window.showInformationMessage('gait hover deactivated.');
        }
    });

    // Make sure to clear the interval when the extension is deactivated

    const excludeSearchCommand = vscode.commands.registerCommand('gait.excludeSearch', async () => {
        try {
            await addGaitSearchExclusion();
            vscode.window.showInformationMessage('Excluded .gait files from search.');
        } catch (error) {
            console.error('Error excluding .gait files from search:', error);
            vscode.window.showErrorMessage('Failed to exclude .gait files from search.');
        }
    });

    const removeGaitCommand = vscode.commands.registerCommand('gait.removeGait', async () => {
        context.workspaceState.update('usingGait', 'false');
        removeGait();
        vscode.commands.executeCommand('workbench.action.reloadWindow');
    });

    // Register all commands
    context.subscriptions.push(
        removePanelChatCommand,
        inlineChatStartOverride, 
        excludeSearchCommand,
        deleteInlineChatCommand, 
        openFileWithContentCommand,
        toggleHoverCommand,
        exportPanelChatsToMarkdownCommand,
        removeGaitCommand,
        initializeGaitCommand
    );

    debouncedRedecorate(context);
    vscode.window.onDidChangeActiveTextEditor(() => {
        debouncedRedecorate(context);
    });
    
    vscode.workspace.onDidSaveTextDocument(() => {
        debouncedRedecorate(context);
    });

    vscode.window.onDidChangeTextEditorSelection((event) => {
        if (gitHistory) {
            hoverDecorationTypes = InlineDecoration.addDecorationForLine(context, event.textEditor, event.selections[0].active.line, hoverDecorationTypes, gitHistory);
        }
    });

    // Add a new event listener for text changes
    vscode.workspace.onDidChangeTextDocument((event) => {
        handleFileChange(event);
        debouncedRedecorate(context);
    });

    // Set up an interval to trigger accept every second
    const acceptInterval = setInterval(async () => {
        try {
            await triggerAccept(stateReader, context);
            triggerAcceptCount++;
            if (triggerAcceptCount % 3 === 0) {
                const filePath = `.gait/${STASHED_GAIT_STATE_FILE_NAME}`;
                gitHistory = await getGitHistory(context, workspaceFolder.uri.fsPath, filePath);
                if (await stateReader.matchPromptsToDiff()) {
                    debouncedRedecorate(context);
                }
            }
            if (triggerAcceptCount % 4000 === 0) {
                triggerAcceptCount = 0;
            }
            if (lastPanelChatMessageNum !== context.workspaceState.get('panelChatMessageNum')) {
                lastPanelChatMessageNum = context.workspaceState.get('panelChatMessageNum') || 0;
                debouncedRedecorate(context);
                InlineDecoration.writeMatchStatistics(context);
            }
        } catch (error) {
            console.log("Error in accept interval", error);
        }
    }, 1000);

    context.subscriptions.push(
        vscode.commands.registerCommand('gait.showIndividualPanelChat', async (args) => {
            let panelChatId = args.panelChatId;
            if (!panelChatId) {
                // If no panelChatId is provided, prompt the user to enter one
                panelChatId = await vscode.window.showInputBox({
                    prompt: 'Enter the Panel Chat ID',
                    placeHolder: 'e.g., panel-chat-123'
                });
            }

            if (panelChatId) {
                provider.handleSwitchToIndividualView(panelChatId);
            } else {
                vscode.window.showErrorMessage('No Panel Chat ID provided.');
            }
        })
    );
    // Make sure to clear the interval when the extension is deactivated
    context.subscriptions.push({
        dispose: () => clearInterval(acceptInterval)
    });

    InlineDecoration.writeMatchStatistics(context);
}

/**
 * Deactivates the extension.
 */
export function deactivate() {
    posthog.capture('deactivate');
}
