import posthog from "posthog-js";

import simpleGit, { SimpleGit } from 'simple-git';
import * as vscode from 'vscode';
import * as crypto from 'crypto';

export async function identifyUser(): Promise<void> {
    const git: SimpleGit = simpleGit();
    
    try {
        const userEmail = await git.raw(['config', '--get', 'user.email']);
        const trimmedEmail = userEmail.trim();
        if (trimmedEmail) {
            const hashedEmail = crypto.createHash('sha256').update(trimmedEmail).digest('hex');
            posthog.identify(hashedEmail, { email: trimmedEmail });
        } else {
            // console.log('No Git user email found');
            posthog.capture('no_git_user_email_found');
        }
    } catch (error) {
        console.error('Error identifying user:', error);
        posthog.capture('error_identifying_user', { error: error });
    }
}

export async function identifyRepo(context: vscode.ExtensionContext): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return;
    }
    // Check if repo global state exists, if not, set it to the first commit hash
    const repoId = context.workspaceState.get('repoid');
    if (!repoId) {
        try {
            const git: SimpleGit = simpleGit(workspaceFolder.uri.fsPath);
            const log = await git.raw('rev-list', '--max-parents=0', 'HEAD');
            const firstCommitHash = log.trim();
            context.workspaceState.update('repoid', firstCommitHash);
        } catch (error) {
            console.error('Error getting first commit hash:', error);
        }
    }   
}