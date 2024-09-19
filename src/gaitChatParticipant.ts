import * as vscode from 'vscode';

const GAIT_PARTICIPANT_ID = 'gait-participant.gait';

interface IGaitChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    }
}

export function activateGaitParticipant(context: vscode.ExtensionContext, additional_context: string) {
    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IGaitChatResult> => {
        try {
            const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
            if (model) {
                const messages = [
                    vscode.LanguageModelChatMessage.User("You are an LLM tasked with providing insights and making edits to code - here are past conversations for context, and the pieces in the code base that they correspond to: " + additional_context),
                    vscode.LanguageModelChatMessage.User(request.prompt)
                ];

                const chatResponse = await model.sendRequest(messages, {}, token);
                for await (const fragment of chatResponse.text) {
                    stream.markdown(fragment);
                }
            }
        } catch (err) {
            handleError(err, stream);
        }

        return { metadata: { command: 'gait' } };
    };

    const gait = vscode.chat.createChatParticipant(GAIT_PARTICIPANT_ID, handler);
    gait.iconPath = vscode.Uri.joinPath(context.extensionUri, 'gait-icon.png');

    context.subscriptions.push(gait);
    return gait;
}

function handleError(err: any, stream: vscode.ChatResponseStream): void {
    console.error(err);
    stream.markdown('An error occurred while processing your request.');
}
