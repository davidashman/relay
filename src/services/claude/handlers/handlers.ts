/**
 * Claude Agent Handlers -
 *
 *  WebView
 *  HandlerContext
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type {
    InitRequest,
    InitResponse,
    GetClaudeStateRequest,
    GetClaudeStateResponse,
    GetMcpServersRequest,
    GetMcpServersResponse,
    GetAssetUrisRequest,
    GetAssetUrisResponse,
    OpenFileRequest,
    OpenFileResponse,
    GetCurrentSelectionResponse,
    ShowNotificationRequest,
    ShowNotificationResponse,
    NewConversationTabRequest,
    NewConversationTabResponse,
    RenameTabRequest,
    RenameTabResponse,
    OpenDiffRequest,
    OpenDiffResponse,
    ListSessionsRequest,
    ListSessionsResponse,
    GetSessionRequest,
    GetSessionResponse,
    ExecRequest,
    ExecResponse,
    ListFilesRequest,
    ListFilesResponse,
    StatPathRequest,
    StatPathResponse,
    OpenContentRequest,
    OpenContentResponse,
    OpenAttachmentRequest,
    OpenAttachmentResponse,
    OpenURLRequest,
    OpenURLResponse,
    // GetAuthStatusRequest,
    // GetAuthStatusResponse,
    // LoginRequest,
    // LoginResponse,
    // SubmitOAuthCodeRequest,
    // SubmitOAuthCodeResponse,
    OpenConfigFileRequest,
    OpenConfigFileResponse,
    OpenClaudeInTerminalRequest,
    OpenClaudeInTerminalResponse,
    GetExtensionConfigRequest,
    GetExtensionConfigResponse,
    UpdateExtensionConfigRequest,
    UpdateExtensionConfigResponse,
    SdkProbeRequest,
    SdkProbeResponse,
    GetAgentDefinitionRequest,
    GetAgentDefinitionResponse,
    ListAgentsRequest,
    ListAgentsResponse,
    AgentDefinition,
    UpdateSessionMetaRequest,
    UpdateSessionMetaResponse,
} from '../../../shared/messages';
import type { HandlerContext } from './types';
import type { PermissionMode, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { AsyncStream } from '../transport/AsyncStream';
/**
 */
export async function handleInit(
    _request: InitRequest,
    context: HandlerContext
): Promise<InitResponse> {
    const { configService, workspaceService, logService, agentService } = context;

    logService.info('[handleInit] ');

    // TODO:  AuthManager
    // const authStatus = null;

    //  CLI settings.json  'model'  Settings  Model Manage
    const modelSetting = (await configService.getSetting<string>('model')) || 'default';

    const defaultCwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();

    // TODO:  openNewInTab
    const openNewInTab = false;

    // Read VSCode extension settings
    const vscodeConfig = vscode.workspace.getConfiguration('relay');
    const defaultThinkingLevel = vscodeConfig.get<string>('defaultThinkingLevel') ?? 'on';
    const defaultPermissionMode = vscodeConfig.get<string>('defaultPermissionMode') ?? 'default';
    const expandToolOutput = vscodeConfig.get<boolean>('expandToolOutput') ?? true;
    const showThinking = vscodeConfig.get<boolean>('showThinking') ?? false;
    const autoInterruptOnRoaming = vscodeConfig.get<boolean>('autoInterruptOnRoaming') ?? false;

    const thinkingLevel = defaultThinkingLevel;
    const permissionMode = defaultPermissionMode;

    return {
        type: "init_response",
        state: {
            defaultCwd,
            openNewInTab,
            // authStatus,
            modelSetting,
            platform: process.platform,
            thinkingLevel,
            permissionMode,
            expandToolOutput,
            showThinking,
            autoInterruptOnRoaming
        }
    };
}

/**
 *  Claude
 */
export async function handleGetClaudeState(
    _request: GetClaudeStateRequest,
    context: HandlerContext
): Promise<GetClaudeStateResponse> {
    const { logService } = context;

    logService.info('[handleGetClaudeState]  Claude ');

    const config = await loadConfig(context);

    return {
        type: "get_claude_state_response",
        config
    };
}

/**
 *  SDK
 */
export async function handleSdkProbe(
    request: SdkProbeRequest,
    context: HandlerContext
): Promise<SdkProbeResponse> {
    const { sdkService, workspaceService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    const result = await sdkService.probe({
        capabilities: request.capabilities ?? [],
        cwd,
        timeoutMs: request.timeoutMs
    });

    return {
        type: "sdk_probe_response",
        data: result.data,
        errors: result.errors
    };
}

/**
 *  MCP
 */
export async function handleGetMcpServers(
    _request: GetMcpServersRequest,
    context: HandlerContext,
    channelId?: string
): Promise<GetMcpServersResponse> {
    return await getMcpServers(context, channelId);
}

/**
 *  URI
 */
export async function handleGetAssetUris(
    _request: GetAssetUrisRequest,
    context: HandlerContext
): Promise<GetAssetUrisResponse> {
    return {
        type: "asset_uris_response",
        assetUris: getAssetUris(context)
    };
}

/**
 * Handle get_extension_config request
 */
export async function handleGetExtensionConfig(
    _request: GetExtensionConfigRequest,
    context: HandlerContext
): Promise<GetExtensionConfigResponse> {
    const config = await context.configService.getExtensionConfig();
    config.defaultAgent = vscode.workspace.getConfiguration('relay').get<string>('defaultAgent', '');
    return {
        type: 'get_extension_config_response',
        config
    };
}

/**
 * Handle update_extension_config request
 */
export async function handleUpdateExtensionConfig(
    request: UpdateExtensionConfigRequest,
    context: HandlerContext
): Promise<UpdateExtensionConfigResponse> {
    if (request.key === 'defaultAgent') {
        await vscode.workspace.getConfiguration('relay').update('defaultAgent', request.value, vscode.ConfigurationTarget.Global);
    } else {
        await context.configService.updateExtensionConfig(request.key as any, request.value);
    }

    // Broadcast config change to all webviews (so chat page ModelSelect can refresh)
    context.webViewService.postMessage({
        type: 'request',
        requestId: `config-changed-${Date.now()}`,
        request: {
            type: 'extension_config_changed',
            key: request.key,
            value: request.value,
        }
    });

    return {
        type: 'update_extension_config_response',
        success: true
    };
}

/**
 */
export async function handleOpenFile(
    request: OpenFileRequest,
    context: HandlerContext
): Promise<OpenFileResponse> {
    const { logService, workspaceService, fileSystemService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    const { filePath, location } = request;

    try {
        // Resolve the path directly without fuzzy search
        // This ensures we open the exact file that was referenced, not a similar one
        const resolvedPath = fileSystemService.resolveFilePath(filePath, cwd);

        // Check if the path exists
        const exists = await fileSystemService.pathExists(resolvedPath);
        if (!exists) {
            throw new Error(`File not found: ${filePath}`);
        }

        const stat = await fs.promises.stat(resolvedPath);
        const uri = vscode.Uri.file(resolvedPath);

        if (stat.isDirectory()) {
            await vscode.commands.executeCommand("revealInExplorer", uri);
            return { type: "open_file_response" };
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });

        if (location) {
            const startLine = Math.max((location.startLine ?? 1) - 1, 0);
            const endLine = Math.max((location.endLine ?? location.startLine ?? 1) - 1, startLine);
            const startColumn = Math.max(location.startColumn ?? 0, 0);
            const endColumn = Math.max(location.endColumn ?? startColumn, startColumn);

            const range = new vscode.Range(
                new vscode.Position(startLine, startColumn),
                new vscode.Position(endLine, endColumn)
            );

            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(range.start, range.end);
        }

        return { type: "open_file_response" };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logService.error(`[handleOpenFile] : ${errorMsg}`);
        throw new Error(`Failed to open file: ${errorMsg}`);
    }
}

/**
 */
export async function handleGetCurrentSelection(
    context: HandlerContext
): Promise<GetCurrentSelectionResponse> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty || editor.document.uri.scheme !== "file") {
        return {
            type: "get_current_selection_response",
            selection: null
        };
    }

    const document = editor.document;
    const selection = editor.selection;

    return {
        type: "get_current_selection_response",
        selection: {
            filePath: document.uri.fsPath,
            startLine: selection.start.line + 1,
            endLine: selection.end.line + 1,
            startColumn: selection.start.character,
            endColumn: selection.end.character,
            selectedText: document.getText(selection)
        }
    };
}

/**
 */
export async function handleShowNotification(
    request: ShowNotificationRequest,
    context: HandlerContext
): Promise<ShowNotificationResponse> {
    const { message, severity, buttons = [] } = request;

    // Check if notifications are enabled
    const config = vscode.workspace.getConfiguration('relay');
    const showNotifications = config.get<boolean>('showNotifications', true);

    if (!showNotifications) {
        // Return undefined to indicate no button was clicked
        return {
            type: "show_notification_response",
            buttonValue: undefined
        };
    }

    let result: string | undefined;
    switch (severity) {
        case "error":
            result = await vscode.window.showErrorMessage(message, ...buttons);
            break;
        case "warning":
            result = await vscode.window.showWarningMessage(message, ...buttons);
            break;
        case "info":
        default:
            result = await vscode.window.showInformationMessage(message, ...buttons);
            break;
    }

    return {
        type: "show_notification_response",
        buttonValue: result
    };
}

/**
 */
export async function handleNewConversationTab(
    _request: NewConversationTabRequest,
    context: HandlerContext
): Promise<NewConversationTabResponse> {
    const { logService } = context;

    try {
        await vscode.commands.executeCommand("relay.sessionList.focus");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logService.warn(`Failed to focus chat view: ${message}`);
    }
    return {
        type: "new_conversation_tab_response"
    };
}

/**
 */
export async function handleRenameTab(
    _request: RenameTabRequest,
    context: HandlerContext
): Promise<RenameTabResponse> {
    return {
        type: "rename_tab_response"
    };
}

/**
 *  Diff
 */
export async function handleOpenDiff(
    request: OpenDiffRequest,
    context: HandlerContext,
    signal: AbortSignal
): Promise<OpenDiffResponse> {
    const { logService, workspaceService, fileSystemService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();

    logService.info(`Opening diff for: ${request.originalFilePath}`);

    const originalPath = fileSystemService.resolveFilePath(request.originalFilePath, cwd);
    const fallbackNewPath = request.newFilePath ? fileSystemService.resolveFilePath(request.newFilePath, cwd) : undefined;

    if (signal.aborted) {
        return {
            type: "open_diff_response",
            newEdits: request.edits
        };
    }

    const rightPath = await prepareDiffRightFile(originalPath, fallbackNewPath, request.edits, context);

    const leftExists = await fileSystemService.pathExists(originalPath);
    const leftPath = leftExists
        ? originalPath
        : await fileSystemService.createTempFile(path.basename(request.originalFilePath || request.newFilePath || "untitled"), "");

    const leftUri = vscode.Uri.file(leftPath);
    const rightUri = vscode.Uri.file(rightPath);

    const diffTitle = `${path.basename(request.originalFilePath || request.newFilePath || rightPath)} (Claude)`;

    await vscode.commands.executeCommand(
        "vscode.diff",
        leftUri,
        rightUri,
        diffTitle,
        { preview: true }
    );

    return {
        type: "open_diff_response",
        newEdits: request.edits
    };
}

/**
 */
export async function handleListSessions(
    _request: ListSessionsRequest,
    context: HandlerContext
): Promise<ListSessionsResponse> {
    const { logService, sessionService, workspaceService } = context;

    try {
        const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
        const sessions = await sessionService.listSessions(cwd);

        //  worktree  isCurrentWorkspace
        const sessionsWithMeta = sessions.map(session => ({
            ...session,
            worktree: undefined,
            isCurrentWorkspace: true
        }));

        logService.info(`[handleListSessions] returning ${sessionsWithMeta.length} sessions: [${sessionsWithMeta.map(s => s.id).join(', ')}]`);
        return {
            type: "list_sessions_response",
            sessions: sessionsWithMeta
        };
    } catch (error) {
        logService.error(`Failed to list sessions: ${error}`);
        return {
            type: "list_sessions_response",
            sessions: []
        };
    }
}

export async function handleUpdateSessionMeta(
    request: UpdateSessionMetaRequest,
    context: HandlerContext
): Promise<UpdateSessionMetaResponse> {
    const { sessionService, workspaceService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    await sessionService.updateSessionMeta(request.sessionId, cwd, request.agent);
    return { type: 'update_session_meta_response' };
}

/**
 */
export async function handleGetSession(
    request: GetSessionRequest,
    context: HandlerContext
): Promise<GetSessionResponse> {
    const { logService, sessionService, workspaceService } = context;

    try {
        const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
        const messages = await sessionService.getSession(request.sessionId, cwd);

        logService.info(`[handleGetSession] returning ${messages.length} messages for sessionId=${request.sessionId}`);
        return {
            type: "get_session_response",
            messages
        };
    } catch (error) {
        logService.error(`Failed to get session: ${error}`);
        return {
            type: "get_session_response",
            messages: []
        };
    }
}

/**
 */
export async function handleExec(
    request: ExecRequest,
    context: HandlerContext
): Promise<ExecResponse> {
    const { workspaceService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    const { command, params } = request;

    return new Promise<ExecResponse>((resolve) => {
        const { spawn } = require('child_process');
        let stdout = "";
        let stderr = "";

        const proc = spawn(command, params, {
            cwd,
            shell: false
        });

        proc.stdout?.on("data", (data: Buffer) => {
            stdout += data.toString();
        });

        proc.stderr?.on("data", (data: Buffer) => {
            stderr += data.toString();
        });

        proc.on("close", (code: number) => {
            resolve({
                type: "exec_response",
                stdout,
                stderr,
                exitCode: code || 0
            });
        });

        proc.on("error", (error: Error) => {
            resolve({
                type: "exec_response",
                stdout: "",
                stderr: error.message,
                exitCode: 1
            });
        });
    });
}

/**
 */
export async function handleListFiles(
    request: ListFilesRequest,
    context: HandlerContext
): Promise<ListFilesResponse> {
    const { workspaceService, fileSystemService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();

    return {
        type: "list_files_response",
        files: await fileSystemService.findFiles(request.pattern, cwd)
    };
}

/**
 *  /  /
 */
export async function handleStatPath(
    request: StatPathRequest,
    context: HandlerContext
): Promise<StatPathResponse> {
    const { workspaceService, fileSystemService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    const paths = Array.isArray(request.paths) ? request.paths : [];

    const entries: StatPathResponse["entries"] = [];

    for (const raw of paths) {
        if (!raw || typeof raw !== "string") {
            continue;
        }

        const absolute = fileSystemService.normalizeAbsolutePath(raw, cwd);

        try {
            const stat = await fs.promises.stat(absolute);
            let type: StatPathResponse["entries"][number]["type"] = "other";

            if (stat.isFile()) type = "file";
            else if (stat.isDirectory()) type = "directory";

            entries.push({ path: raw, type });
        } catch {
            entries.push({ path: raw, type: "not_found" });
        }
    }

    return {
        type: "stat_path_response",
        entries
    };
}

/**
 */
export async function handleOpenContent(
    request: OpenContentRequest,
    context: HandlerContext,
    signal: AbortSignal
): Promise<OpenContentResponse> {
    const { logService, fileSystemService } = context;
    const { content, fileName, editable } = request;

    logService.info(`Opening content as: ${fileName} (editable: ${editable})`);

    if (!editable) {
        const document = await vscode.workspace.openTextDocument({
            content,
            language: detectLanguage(fileName)
        });
        await vscode.window.showTextDocument(document, { preview: true });

        return {
            type: "open_content_response"
        };
    }

    const tempPath = await fileSystemService.createTempFile(fileName || "claude.txt", content);
    const tempUri = vscode.Uri.file(tempPath);
    const document = await vscode.workspace.openTextDocument(tempUri);
    await vscode.window.showTextDocument(document, { preview: false });

    const updatedContent = await waitForDocumentEdits(document, signal);

    return {
        type: "open_content_response",
        updatedContent
    };
}

/**
 *  base64 /  VS Code
 */
export async function handleOpenAttachment(
    request: OpenAttachmentRequest,
    context: HandlerContext
): Promise<OpenAttachmentResponse> {
    const { logService, fileSystemService } = context;
    const { fileName, mediaType, data } = request;

    logService.info(`Opening attachment: ${fileName} (${mediaType})`);

    const sanitized = fileSystemService.sanitizeFileName(fileName || 'attachment');
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claude-attachment-'));
    const filePath = path.join(tempDir, sanitized);

    const buffer = Buffer.from(data, 'base64');
    await fs.promises.writeFile(filePath, buffer);

    const uri = vscode.Uri.file(filePath);
    await vscode.commands.executeCommand('vscode.open', uri);

    return {
        type: "open_attachment_response"
    };
}

/**
 *  URL
 */
export async function handleOpenURL(
    request: OpenURLRequest,
    context: HandlerContext
): Promise<OpenURLResponse> {
    const { url } = request;

    try {
        await vscode.env.openExternal(vscode.Uri.parse(url));
        return { type: "open_url_response" };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to open URL: ${errorMsg}`);
    }
}

/**
 */
// export async function handleGetAuthStatus(
//     _request: GetAuthStatusRequest,
//     context: HandlerContext
// ): Promise<GetAuthStatusResponse> {
//     // TODO:
//     // const status = authManager?.getAuthStatus();

//     return {
//         type: "get_auth_status_response",
//         status: null
//     };
// }

/**
 */
// export async function handleLogin(
//     request: LoginRequest,
//     context: HandlerContext
// ): Promise<LoginResponse> {
//     const { logService, agentService } = context;
//     const { method } = request;

//     // TODO:
//     logService.info(`Login requested with method: ${method}`);

//     //
//     await agentService.closeAllChannelsWithCredentialChange();

//     return {
//         type: "login_response",
//         auth: {
//             authenticated: false
//         }
//     };
// }

/**
 *  OAuth
 */
// export async function handleSubmitOAuthCode(
//     request: SubmitOAuthCodeRequest,
//     context: HandlerContext
// ): Promise<SubmitOAuthCodeResponse> {
//     const { logService } = context;
//     const { code } = request;

//     // TODO:  OAuth
//     logService.info(`OAuth code submitted: ${code.substring(0, 10)}...`);

//     return {
//         type: "submit_oauth_code_response"
//     };
// }

/**
 */
export async function handleOpenConfigFile(
    request: OpenConfigFileRequest,
    context: HandlerContext
): Promise<OpenConfigFileResponse> {
    const { configType } = request;

    try {
        // VS Code
        if (configType === "vscode") {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'relay');
        }
        else {
            const configPath = getConfigFilePath(configType);
            const uri = vscode.Uri.file(configPath);
            await vscode.window.showTextDocument(uri);
        }

        return { type: "open_config_file_response" };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to open config file: ${errorMsg}`);
    }
}

/**
 *  Claude
 */
export async function handleOpenClaudeInTerminal(
    _request: OpenClaudeInTerminalRequest,
    context: HandlerContext
): Promise<OpenClaudeInTerminalResponse> {
    const { workspaceService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();

    try {
        const terminal = vscode.window.createTerminal({
            name: "Claude Code",
            cwd
        });

        terminal.show();
        terminal.sendText("claude --help");

        return { type: "open_claude_in_terminal_response" };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to open terminal: ${errorMsg}`);
    }
}

// ============================================================================
// ============================================================================

/**
 */
async function loadConfig(context: HandlerContext): Promise<any> {
    const { logService, sdkService, workspaceService } = context;

    logService.info("Loading config cache by launching Claude...");

    const inputStream = new AsyncStream<SDKUserMessage>();
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();

    const query = await sdkService.query({
        inputStream,
        resume: null,
        canUseTool: async () => ({
            behavior: "deny" as const,
            message: "Config loading only"
        }),
        model: "default",
        cwd,
        permissionMode: "default"
    });

    inputStream.done();

    const config = {
        slashCommands: await (query as any).supportedCommands?.() || [],
        models: await (query as any).supportedModels?.() || [],
        accountInfo: await (query as any).accountInfo?.() || null
    };

    logService.info(`  - Config: [${JSON.stringify(config)}]`);
    await query.return?.();

    return config;
}

/**
 *  MCP
 */
async function getMcpServers(
    context: HandlerContext,
    channelId?: string
): Promise<GetMcpServersResponse> {
    const { logService, agentService } = context;

    if (!channelId) {
        throw new Error('Channel ID is required');
    }

    // TODO:  agentService  channel
    // const channel = agentService.getChannel(channelId);

    try {
        return {
            type: "get_mcp_servers_response",
            // mcpServers: await channel.query.mcpServerStatus?.() || []
            mcpServers: []
        };
    } catch (error) {
        logService.error(`Error fetching MCP servers: ${error}`);
        return {
            type: "get_mcp_servers_response",
            mcpServers: []
        };
    }
}

/**
 *  URI
 */
function getAssetUris(context: HandlerContext): Record<string, { light: string; dark: string }> {
    const { webViewService } = context;
    const webview = webViewService.getWebView();

    if (!webview) {
        return {};
    }

    const assets = {
        relay: {
            light: path.join("resources", "relay-logo.svg"),
            dark: path.join("resources", "relay-logo.svg")
        }
    } as const;

    // TODO:  extensionPath
    const extensionPath = process.cwd();

    const toWebviewUri = (relativePath: string) =>
        webview.asWebviewUri(
            vscode.Uri.file(path.join(extensionPath, relativePath))
        ).toString();

    return Object.fromEntries(
        Object.entries(assets).map(([key, value]) => [
            key,
            {
                light: toWebviewUri(value.light),
                dark: toWebviewUri(value.dark)
            }
        ])
    );
}

// ============================================================================
// ============================================================================

async function prepareDiffRightFile(
    originalPath: string,
    fallbackPath: string | undefined,
    edits: OpenDiffRequest["edits"],
    context: HandlerContext
): Promise<string> {
    let baseContent = "";

    if (await context.fileSystemService.pathExists(originalPath)) {
        baseContent = await fs.promises.readFile(originalPath, "utf8");
    } else if (fallbackPath && await context.fileSystemService.pathExists(fallbackPath)) {
        baseContent = await fs.promises.readFile(fallbackPath, "utf8");
    }

    let modified = baseContent;

    for (const edit of edits) {
        const oldString = edit.oldString ?? "";
        const newString = edit.newString ?? "";

        if (!oldString) {
            modified += newString;
            continue;
        }

        if (edit.replaceAll) {
            modified = modified.split(oldString).join(newString);
        } else {
            const index = modified.indexOf(oldString);
            if (index >= 0) {
                modified = `${modified.slice(0, index)}${newString}${modified.slice(index + oldString.length)}`;
            } else {
                modified += newString;
            }
        }
    }

    const baseName = path.basename(fallbackPath || originalPath || "claude.diff");
    const outputName = baseName.endsWith(".claude") ? baseName : `${baseName}.claude`;

    return context.fileSystemService.createTempFile(outputName, modified);
}

async function waitForDocumentEdits(
    document: vscode.TextDocument,
    signal: AbortSignal
): Promise<string> {
    let currentText = document.getText();
    let resolved = false;

    return new Promise<string>((resolve) => {
        const disposables: vscode.Disposable[] = [];

        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                disposables.forEach(d => d.dispose());
            }
        };

        disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.toString() === document.uri.toString()) {
                    currentText = event.document.getText();
                }
            })
        );

        disposables.push(
            vscode.workspace.onDidSaveTextDocument(event => {
                if (event.uri.toString() === document.uri.toString()) {
                    currentText = event.getText();
                    cleanup();
                    resolve(currentText);
                }
            })
        );

        disposables.push(
            vscode.workspace.onDidCloseTextDocument(event => {
                if (event.uri.toString() === document.uri.toString()) {
                    cleanup();
                    resolve(currentText);
                }
            })
        );

        if (signal.aborted) {
            cleanup();
            resolve(currentText);
            return;
        }

        signal.addEventListener("abort", () => {
            cleanup();
            resolve(currentText);
        }, { once: true });
    });
}

function detectLanguage(fileName?: string): string {
    if (!fileName) {
        return "plaintext";
    }

    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
        case ".ts":
        case ".tsx":
            return "typescript";
        case ".js":
        case ".jsx":
            return "javascript";
        case ".json":
            return "json";
        case ".py":
            return "python";
        case ".java":
            return "java";
        case ".go":
            return "go";
        case ".rs":
            return "rust";
        case ".md":
            return "markdown";
        case ".sh":
            return "shellscript";
        case ".css":
            return "css";
        case ".html":
        case ".htm":
            return "html";
        default:
            return "plaintext";
    }
}

export async function handleGetAgentDefinition(
    request: GetAgentDefinitionRequest,
    _context: HandlerContext
): Promise<GetAgentDefinitionResponse> {
    const { subagentType } = request;
    // Strip namespace prefix for matching (e.g. "voltagent-biz:content-marketer" → "content-marketer")
    const bare = subagentType.includes(':') ? subagentType.split(':').pop()! : subagentType;

    const homeDir = os.homedir();
    const claudeDir = path.join(homeDir, '.claude');
    const searchDirs = [
        path.join(claudeDir, 'agents'),
        path.join(claudeDir, 'plugins'),
    ];

    const definition = findAgentDefinition(bare, searchDirs);
    return { type: 'get_agent_definition_response', definition };
}

export async function handleListAgents(
    _request: ListAgentsRequest,
    _context: HandlerContext
): Promise<ListAgentsResponse> {
    const homeDir = os.homedir();
    const claudeDir = path.join(homeDir, '.claude');

    const agents: AgentDefinition[] = [];
    const seen = new Set<string>();

    // Walk ~/.claude/agents/ directly
    walkAllAgents(path.join(claudeDir, 'agents'), agents, seen);

    // Walk plugin cache: find plugin.json files, read their agents arrays
    const cacheDir = path.join(claudeDir, 'plugins', 'cache');
    for (const pluginJsonPath of findPluginJsonFiles(cacheDir)) {
        let manifest: { agents?: string[] };
        try {
            manifest = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
        } catch {
            continue;
        }
        if (!Array.isArray(manifest.agents)) continue;
        const pluginRoot = path.dirname(path.dirname(pluginJsonPath));
        for (const agentPath of manifest.agents) {
            const full = path.resolve(pluginRoot, agentPath);
            const parsed = parseAgentFile(full);
            if (parsed && !seen.has(parsed.name)) {
                seen.add(parsed.name);
                agents.push(parsed);
            }
        }
    }

    return { type: 'list_agents_response', agents };
}

function findPluginJsonFiles(cacheDir: string): string[] {
    const results: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(cacheDir, { withFileTypes: true });
    } catch {
        return results;
    }
    for (const entry of entries) {
        const full = path.join(cacheDir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findPluginJsonFiles(full));
        } else if (entry.isFile() && entry.name === 'plugin.json') {
            results.push(full);
        }
    }
    return results;
}


function walkAllAgents(dir: string, results: AgentDefinition[], seen: Set<string>): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkAllAgents(full, results, seen);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const parsed = parseAgentFile(full);
            if (parsed && !seen.has(parsed.name)) {
                seen.add(parsed.name);
                results.push(parsed);
            }
        }
    }
}

function findAgentDefinition(name: string, dirs: string[]): AgentDefinition | null {
    for (const dir of dirs) {
        const found = walkForAgent(name, dir);
        if (found) return found;
    }
    return null;
}

function walkForAgent(name: string, dir: string): AgentDefinition | null {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = walkForAgent(name, full);
            if (found) return found;
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const parsed = parseAgentFile(full);
            if (parsed && parsed.name === name) return parsed;
        }
    }
    return null;
}

function parseAgentFile(filePath: string): AgentDefinition | null {
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const frontmatter = match[1];

    const get = (key: string) => {
        const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
        return m ? m[1].trim() : undefined;
    };

    const name = get('name');
    if (!name) return null;

    const toolsRaw = get('tools');
    const tools = toolsRaw ? toolsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined;

    return {
        name,
        model: get('model'),
        tools,
        color: get('color'),
        description: get('description'),
    };
}

function getConfigFilePath(configType: string): string {
    const homeDir = os.homedir();

    switch (configType) {
        case "settings":
            return path.join(homeDir, ".claude", "settings.json");
        case "config":
            return path.join(homeDir, ".claude", "config.json");
        case "mcp-global":
            // Global MCP servers: ~/.claude.json (home directory root, NOT inside .claude/)
            return path.join(homeDir, ".claude.json");
        case "mcp-project": {
            // Project MCP servers: .mcp.json in workspace root
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                throw new Error("No workspace folder open");
            }
            return path.join(workspaceRoot, ".mcp.json");
        }
        default:
            return path.join(homeDir, ".claude", `${configType}.json`);
    }
}
