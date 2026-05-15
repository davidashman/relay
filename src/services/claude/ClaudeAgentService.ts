/**
 * ClaudeAgentService - Claude Agent
 *
 * 1.  Claude channels
 * 2.  Transport
 * 3.  Claude launchClaude, interruptClaude
 * 4.  handlers
 * 5. RPC -
 *
 * - IClaudeSdkService: SDK
 * - IClaudeSessionService:
 * - ILogService:
 * -
 */

import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as os from 'os';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { IConfigurationService } from '../configurationService';
import { IWorkspaceService } from '../workspaceService';
import { IFileSystemService } from '../fileSystemService';
import { INotificationService } from '../notificationService';
import { ITerminalService } from '../terminalService';
import { ITabsAndEditorsService } from '../tabsAndEditorsService';
import { IClaudeSdkService, type SdkQueryParams } from './ClaudeSdkService';
import { IClaudeSessionService } from './ClaudeSessionService';
import { IClaudeTerminalService } from './ClaudeTerminalService';
import { RelayMcpServer } from './RelayMcpServer';
import { AsyncStream, ITransport } from './transport';
import { HandlerContext } from './handlers/types';
import { IWebViewService } from '../webViewService';

import type {
    WebViewToExtensionMessage,
    ExtensionToWebViewMessage,
    RequestMessage,
    ResponseMessage,
    ExtensionRequest,
    ToolPermissionRequest,
    ToolPermissionResponse,
} from '../../shared/messages';

// SDK
import type {
    SDKMessage,
    SDKUserMessage,
    Query,
    PermissionResult,
    PermissionUpdate,
    CanUseTool,
    PermissionMode,
    ThinkingConfig,
} from '@anthropic-ai/claude-agent-sdk';

// Handlers
import {
    handleInit,
    handleGetClaudeState,
    handleGetMcpServers,
    handleGetAssetUris,
    handleOpenFile,
    handleGetCurrentSelection,
    handleShowNotification,
    handleNewConversationTab,
    handleRenameTab,
    handleOpenDiff,
    handleListSessions,
    handleGetSession,
    handleExec,
    handleListFiles,
    handleStatPath,
    handleOpenContent,
    handleOpenAttachment,
    handleStageFile,
    handleOpenURL,
    handleOpenConfigFile,
    // handleOpenClaudeInTerminal,
    // handleGetAuthStatus,
    // handleLogin,
    // handleSubmitOAuthCode,
    handleGetExtensionConfig,
    handleUpdateExtensionConfig,
    handleSdkProbe,
    handleGetAgentDefinition,
    handleListAgents,
    handleUpdateSessionMeta,
} from './handlers/handlers';

export const IClaudeAgentService = createDecorator<IClaudeAgentService>('claudeAgentService');

// ============================================================================
// ============================================================================

/**
 * Channel  Claude
 */
export interface Channel {
    in: AsyncStream<SDKUserMessage>;  //  SDK
    query: Query;                      // Query  SDK
}

/**
 */
interface RequestHandler {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
}

/**
 * Claude Agent
 */
export interface IClaudeAgentService {
    readonly _serviceBrand: undefined;

    /**
     *  Transport
     */
    setTransport(transport: ITransport): void;

    /**
     */
    start(): void;

    /**
     */
    fromClient(message: WebViewToExtensionMessage): Promise<void>;

    /**
     *  Claude
     */
    launchClaude(
        channelId: string,
        resume: string | null,
        cwd: string,
        model: string | null,
        agent: string | null,
        permissionMode: string,
        thinkingLevel: string | null,
        effortLevel: string | null
    ): Promise<void>;

    /**
     *  Claude
     */
    interruptClaude(channelId: string): Promise<void>;

    /**
     */
    closeChannel(channelId: string, sendNotification: boolean, error?: string): void;

    /**
     */
    closeAllChannels(): Promise<void>;

    /**
     */
    closeAllChannelsWithCredentialChange(): Promise<void>;

    /**
     */
    processRequest(request: RequestMessage, signal: AbortSignal): Promise<unknown>;

    /**
     */
    setPermissionMode(channelId: string, mode: PermissionMode): Promise<void>;

    /**
     *  Thinking Level
     */
    setThinkingLevel(channelId: string, level: string): Promise<void>;

    /**
     *  Effort LevelOpus 4.6+ adaptive reasoning
     */
    setEffortLevel(channelId: string, level: string): Promise<void>;

    /**
     */
    setModel(channelId: string, model: string): Promise<void>;

    /**
     */
    shutdown(): Promise<void>;
}

// ============================================================================
// ClaudeAgentService
// ============================================================================

/**
 * Claude Agent
 */
export class ClaudeAgentService implements IClaudeAgentService {
    readonly _serviceBrand: undefined;

    // Transport
    private transport?: ITransport;

    private channels = new Map<string, Channel>();

    private fromClientStream = new AsyncStream<WebViewToExtensionMessage>();

    // PTY channel → webviewId + cwd, for directing session-id updates
    private readonly _ptyMeta = new Map<string, { webviewId: string; cwd: string }>();
    // cwd → active FSWatcher (one per unique cwd)
    private readonly _cwdWatchers = new Map<string, fs.FSWatcher>();
    // cwd → reference count (number of active PTY channels for that cwd)
    private readonly _cwdRefCounts = new Map<string, number>();

    private outstandingRequests = new Map<string, RequestHandler>();

    private abortControllers = new Map<string, AbortController>();

    // Handler
    private handlerContext: HandlerContext;

    // Thinking Level
    private thinkingLevel: string = 'on';

    // Effort Level Opus 4.6+ adaptive reasoning
    private effortLevel: string | null = null;

    // HTTP MCP server for terminal-mode PTY permission prompts
    private permissionServer: RelayMcpServer | null = null;
    private permissionServerStarting: Promise<void> | null = null;

    constructor(
        @ILogService private readonly logService: ILogService,
        @IConfigurationService private readonly configService: IConfigurationService,
        @IWorkspaceService private readonly workspaceService: IWorkspaceService,
        @IFileSystemService private readonly fileSystemService: IFileSystemService,
        @INotificationService private readonly notificationService: INotificationService,
        @ITerminalService private readonly terminalService: ITerminalService,
        @ITabsAndEditorsService private readonly tabsAndEditorsService: ITabsAndEditorsService,
        @IClaudeSdkService private readonly sdkService: IClaudeSdkService,
        @IClaudeSessionService private readonly sessionService: IClaudeSessionService,
        @IClaudeTerminalService private readonly claudeTerminalService: IClaudeTerminalService,
        @IWebViewService private readonly webViewService: IWebViewService
    ) {
        //  Handler
        this.handlerContext = {
            logService: this.logService,
            configService: this.configService,
            workspaceService: this.workspaceService,
            fileSystemService: this.fileSystemService,
            notificationService: this.notificationService,
            terminalService: this.terminalService,
            tabsAndEditorsService: this.tabsAndEditorsService,
            sessionService: this.sessionService,
            sdkService: this.sdkService,
            agentService: this,  //
            webViewService: this.webViewService,
        };

        // Wire PTY I/O callbacks
        this.claudeTerminalService.onData((channelId, data) => {
            this.transport?.send({ type: 'pty_data', channelId, data });
        });
        this.claudeTerminalService.onExit((channelId, exitCode) => {
            this.transport?.send({ type: 'pty_exit', channelId, exitCode });
            this._stopProjectDirWatch(channelId);
            this.permissionServer?.cleanupChannel(channelId).catch(() => {});
        });
    }

    /**
     *  Transport
     */
    setTransport(transport: ITransport): void {
        this.transport = transport;

        transport.onMessage(async (message) => {
            await this.fromClient(message);
        });

        this.logService.info('[ClaudeAgentService] Transport ');
    }

    /**
     */
    start(): void {
        this.readFromClient();

        this.logService.info('[ClaudeAgentService] ');
    }

    /**
     */
    async fromClient(message: WebViewToExtensionMessage): Promise<void> {
        this.fromClientStream.enqueue(message);
    }

    /**
     */
    private async readFromClient(): Promise<void> {
        this.logService.info('[ClaudeAgentService] readFromClient loop started');
        try {
            for await (const message of this.fromClientStream) {
                switch (message.type) {
                    case "launch_claude":
                        this.logService.info(`[ClaudeAgentService] launch_claude received: channel=${message.channelId} resume=${message.resume ?? 'null'}`);
                        void this.launchClaude(
                            message.channelId,
                            message.resume || null,
                            message.cwd || this.getCwd(),
                            message.model || null,
                            message.agent || null,
                            message.permissionMode || "default",
                            message.thinkingLevel || null,
                            message.effortLevel || null
                        ).catch(error => {
                            this.logService.error(`[ClaudeAgentService] launch_claude error for channel ${message.channelId}: ${error}`);
                        });
                        break;

                    case "close_channel":
                        this.closeChannel(message.channelId, false);
                        break;

                    case "interrupt_claude":
                        await this.interruptClaude(message.channelId);
                        break;

                    case "io_message":
                        this.transportMessage(
                            message.channelId,
                            message.message,
                            message.done
                        );
                        break;

                    case "request":
                        this.handleRequest(message);
                        break;

                    case "response":
                        this.handleResponse(message);
                        break;

                    case "launch_pty": {
                        const ptyCwd = message.cwd || this.getCwd();
                        void (async () => {
                            let mcpConfigPath: string | undefined;
                            try {
                                const server = await this.ensurePermissionServer();
                                mcpConfigPath = await server.writeMcpConfig(message.channelId);
                                this.logService.info(`[ClaudeAgentService] MCP config written: ${mcpConfigPath}`);
                            } catch (err) {
                                this.logService.warn(`[ClaudeAgentService] MCP server unavailable, falling back to CLI prompts: ${err}`);
                            }
                            this.logService.info(`[ClaudeAgentService] spawning PTY channel=${message.channelId} mcpConfigPath=${mcpConfigPath ?? 'none'}`);
                            await this.claudeTerminalService.spawn({
                                channelId: message.channelId,
                                resume: message.resume,
                                agent: message.agent,
                                permissionMode: message.permissionMode,
                                model: message.model,
                                effortLevel: message.effortLevel,
                                cwd: ptyCwd,
                                cols: message.cols,
                                rows: message.rows,
                                mcpConfigPath,
                            });
                        })().catch(err => {
                            this.logService.error(`[ClaudeAgentService] launch_pty error: ${err}`);
                        });
                        if (message.webviewId && ptyCwd) {
                            void this._startProjectDirWatch(message.channelId, message.webviewId, ptyCwd);
                        }
                        break;
                    }

                    case "pty_input":
                        this.claudeTerminalService.write(message.channelId, message.data);
                        if (message.data.includes('\r')) {
                            this.transport?.send({ type: 'pty_turn_start', channelId: message.channelId });
                        }
                        break;

                    case "pty_resize":
                        this.claudeTerminalService.resize(message.channelId, message.cols, message.rows);
                        break;

                    case "cancel_request":
                        this.handleCancellation(message.targetRequestId);
                        break;

                    default:
                        this.logService.error(`Unknown message type: ${(message as { type: string }).type}`);
                }
            }
        } catch (error) {
            this.logService.error(`[ClaudeAgentService] readFromClient loop TERMINATED unexpectedly: ${error}`);
        }
        this.logService.warn('[ClaudeAgentService] readFromClient loop ended — no more messages will be processed');
    }

    /**
     *  Claude
     */
    async launchClaude(
        channelId: string,
        resume: string | null,
        cwd: string,
        model: string | null,
        agent: string | null,
        permissionMode: string,
        thinkingLevel: string | null,
        effortLevel: string | null
    ): Promise<void> {
        //  thinkingLevel
        if (thinkingLevel) {
            this.thinkingLevel = thinkingLevel;
        }

        //  effortLevel
        if (effortLevel) {
            this.effortLevel = effortLevel;
        }

        const thinking = this.getThinkingConfig(this.thinkingLevel, model);

        this.logService.info('');
        this.logService.info('╔════════════════════════════════════════╗');
        this.logService.info('║   Claude                        ║');
        this.logService.info('╚════════════════════════════════════════╝');
        this.logService.info(`  Channel ID: ${channelId}`);
        this.logService.info(`  Resume: ${resume || 'null'}`);
        this.logService.info(`  CWD: ${cwd}`);
        this.logService.info(`  Model: ${model || 'null'}`);
        this.logService.info(`  Agent: ${agent || 'none'}`);
        this.logService.info(`  Permission: ${permissionMode}`);
        this.logService.info(`  Thinking Level: ${this.thinkingLevel}`);
        this.logService.info(`  Thinking Config: ${JSON.stringify(thinking)}`);
        this.logService.info(`  Effort Level: ${this.effortLevel ?? 'null'}`);
        this.logService.info('');

        if (this.channels.has(channelId)) {
            this.logService.error(`❌ Channel : ${channelId}`);
            throw new Error(`Channel already exists: ${channelId}`);
        }

        try {
            // 1.
            this.logService.info('📝  1: ');
            const inputStream = new AsyncStream<SDKUserMessage>();
            this.logService.info('  ✓ ');

            // 2.  spawnClaude
            this.logService.info('');
            this.logService.info('📝  2:  spawnClaude()');

            // stderr  channel 3s
            let lastStderrErrorTime = 0;
            const STDERR_ERROR_DEBOUNCE_MS = 3000;

            const query = await this.spawnClaude(
                inputStream,
                resume,
                async (toolName, input, options) => {
                    //  RPC  WebView
                    this.logService.info(`🔧 : ${toolName}`);
                    let enrichedInput = input;
                    if (toolName === 'Edit' && typeof input.file_path === 'string' && typeof input.old_string === 'string') {
                        try {
                            const fs = require('fs') as typeof import('fs');
                            const content = await fs.promises.readFile(input.file_path, 'utf8');
                            const idx = content.indexOf(input.old_string);
                            if (idx !== -1) {
                                const oldStart = content.substring(0, idx).split('\n').length;
                                enrichedInput = { ...input, _oldStart: oldStart };
                            }
                        } catch {}
                    }
                    return this.requestToolPermission(
                        channelId,
                        toolName,
                        enrichedInput,
                        options.suggestions || [],
                        agent || undefined
                    );
                },
                model,
                agent,
                cwd,
                permissionMode,
                thinking,
                this.effortLevel,
                // onStderrError:  SDK stderr
                (error) => {
                    const now = Date.now();
                    if (now - lastStderrErrorTime < STDERR_ERROR_DEBOUNCE_MS) return;
                    lastStderrErrorTime = now;
                    this.transport!.send({
                        type: 'sdk_error',
                        channelId,
                        error: error.message,
                        statusCode: error.statusCode,
                        errorType: error.type,
                    } as any);
                }
            );
            this.logService.info('  ✓ spawnClaude() Query ');

            // 3.  channels Map
            this.logService.info('');
            this.logService.info('📝  3:  Channel');
            this.channels.set(channelId, {
                in: inputStream,
                query: query
            });
            this.logService.info(`  ✓ Channel  ${this.channels.size} `);

            // 4.  SDK
            this.logService.info('');
            this.logService.info('📝  4: ');
            (async () => {
                try {
                    this.logService.info(`  →  Query ...`);
                    let messageCount = 0;

                    for await (const message of query) {
                        messageCount++;
                        this.logService.info(`  ←  #${messageCount}: ${message.type}`);

                        this.transport!.send({
                            type: "io_message",
                            channelId,
                            message,
                            done: false
                        });
                    }

                    // Normal completion
                    this.logService.info(`  ✓ Query output completed, ${messageCount} messages total`);
                    this.closeChannel(channelId, true);
                } catch (error) {
                    // Error occurred
                    this.logService.error(`  ❌ Query output error: ${error}`);
                    if (error instanceof Error) {
                        this.logService.error(`     Stack: ${error.stack}`);
                    }
                    this.closeChannel(channelId, true, String(error));
                }
            })();

            this.logService.info('');
            this.logService.info('✓ Claude ');
            this.logService.info('════════════════════════════════════════');
            this.logService.info('');
        } catch (error) {
            this.logService.error('');
            this.logService.error('❌❌❌ Claude  ❌❌❌');
            this.logService.error(`Channel: ${channelId}`);
            this.logService.error(`Error: ${error}`);
            if (error instanceof Error) {
                this.logService.error(`Stack: ${error.stack}`);
            }
            this.logService.error('════════════════════════════════════════');
            this.logService.error('');

            this.closeChannel(channelId, true, String(error));
        }
    }

    /**
     *  Claude
     */
    async interruptClaude(channelId: string): Promise<void> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            this.logService.warn(`[ClaudeAgentService] Channel : ${channelId}`);
            return;
        }

        try {
            await this.sdkService.interrupt(channel.query);
            this.logService.info(`[ClaudeAgentService]  Channel: ${channelId}`);
        } catch (error) {
            this.logService.error(`[ClaudeAgentService] :`, error);
        }
    }

    /**
     */
    closeChannel(channelId: string, sendNotification: boolean, error?: string): void {
        this.logService.info(`[ClaudeAgentService]  Channel: ${channelId}`);

        // 1.
        if (sendNotification && this.transport) {
            this.transport.send({
                type: "close_channel",
                channelId,
                error
            });
        }

        // 2.  channel
        const channel = this.channels.get(channelId);
        if (channel) {
            channel.in.done();
            try {
                channel.query.return?.();
            } catch (e) {
                this.logService.warn(`Error cleaning up channel: ${e}`);
            }
            this.channels.delete(channelId);
        }

        this.logService.info(`  ✓ Channel  ${this.channels.size} `);
    }

    /**
     *  Claude SDK
     *
     * @param inputStream
     * @param resume  ID
     * @param canUseTool
     * @param model
     * @param cwd
     * @param permissionMode
     * @param maxThinkingTokens  tokens
     * @param onStderrError stderr
     * @returns SDK Query
     */
    protected async spawnClaude(
        inputStream: AsyncStream<SDKUserMessage>,
        resume: string | null,
        canUseTool: CanUseTool,
        model: string | null,
        agent: string | null,
        cwd: string,
        permissionMode: string,
        thinking: ThinkingConfig,
        effortLevel: string | null,
        onStderrError?: SdkQueryParams['onStderrError']
    ): Promise<Query> {
        return this.sdkService.query({
            inputStream,
            resume,
            canUseTool,
            model,
            agent,
            cwd,
            permissionMode,
            thinking,
            effortLevel,
            onStderrError
        });
    }

    /**
     */
    async closeAllChannels(): Promise<void> {
        const promises = Array.from(this.channels.keys()).map(channelId =>
            this.closeChannel(channelId, false)
        );
        await Promise.all(promises);
        this.channels.clear();
    }

    /**
     */
    async closeAllChannelsWithCredentialChange(): Promise<void> {
        const promises = Array.from(this.channels.keys()).map(channelId =>
            this.closeChannel(channelId, true)
        );
        await Promise.all(promises);
        this.channels.clear();
    }

    /**
     *  Channel
     */
    private transportMessage(
        channelId: string,
        message: SDKMessage | SDKUserMessage,
        done: boolean
    ): void {
        const channel = this.channels.get(channelId);
        if (!channel) {
            throw new Error(`Channel not found: ${channelId}`);
        }

        if (message.type === "user") {
            channel.in.enqueue(message as SDKUserMessage);
        }

        if (done) {
            channel.in.done();
        }
    }

    /**
     */
    private async handleRequest(message: RequestMessage): Promise<void> {
        const abortController = new AbortController();
        this.abortControllers.set(message.requestId, abortController);

        try {
            const response = await this.processRequest(message, abortController.signal);
            this.transport!.send({
                type: "response",
                requestId: message.requestId,
                response,
                webviewId: message.webviewId
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.transport!.send({
                type: "response",
                requestId: message.requestId,
                response: {
                    type: "error",
                    error: errorMsg
                },
                webviewId: message.webviewId
            });
        } finally {
            this.abortControllers.delete(message.requestId);
        }
    }

    /**
     */
    async processRequest(message: RequestMessage, signal: AbortSignal): Promise<unknown> {
        const request = message.request;
        const channelId = message.channelId;

        if (!request || typeof request !== 'object' || !('type' in request)) {
            throw new Error('Invalid request format');
        }

        this.logService.info(`[ClaudeAgentService] : ${request.type}`);

        //  handler
        switch (request.type) {
            case "init":
                return handleInit(request, this.handlerContext);

            case "get_claude_state":
                return handleGetClaudeState(request, this.handlerContext);

            case "sdk_probe":
                return handleSdkProbe(request as any, this.handlerContext);

            case "get_mcp_servers":
                return handleGetMcpServers(request, this.handlerContext, channelId);

            case "get_asset_uris":
                return handleGetAssetUris(request, this.handlerContext);

            case "open_file":
                return handleOpenFile(request, this.handlerContext);

            case "get_current_selection":
                return handleGetCurrentSelection(this.handlerContext);

            case "open_diff":
                return handleOpenDiff(request, this.handlerContext, signal);

            case "open_content":
                return handleOpenContent(request, this.handlerContext, signal);

            case "open_attachment":
                return handleOpenAttachment(request, this.handlerContext);

            case "stage_file":
                return handleStageFile(request, this.handlerContext);

            // UI
            case "show_notification":
                return handleShowNotification(request, this.handlerContext);

            case "new_conversation_tab":
                return handleNewConversationTab(request, this.handlerContext);

            case "rename_tab":
                return handleRenameTab(request, this.handlerContext);

            case "open_url":
                return handleOpenURL(request, this.handlerContext);

            case "set_permission_mode": {
                if (!channelId) {
                    throw new Error('channelId is required for set_permission_mode');
                }
                const permReq = request as any;
                await this.setPermissionMode(channelId, permReq.mode);
                return {
                    type: "set_permission_mode_response",
                    success: true
                };
            }

            case "set_model": {
                if (!channelId) {
                    throw new Error('channelId is required for set_model');
                }
                const modelReq = request as any;
                const targetModel = modelReq.model?.value ?? "";
                if (!targetModel) {
                    throw new Error("Invalid model selection");
                }
                await this.setModel(channelId, targetModel);
                return {
                    type: "set_model_response",
                    success: true
                };
            }

            case "set_thinking_level": {
                if (!channelId) {
                    throw new Error('channelId is required for set_thinking_level');
                }
                const thinkReq = request as any;
                await this.setThinkingLevel(channelId, thinkReq.thinkingLevel);
                return {
                    type: "set_thinking_level_response"
                };
            }

            case "set_effort_level": {
                if (!channelId) {
                    throw new Error('channelId is required for set_effort_level');
                }
                const effortReq = request as any;
                await this.setEffortLevel(channelId, effortReq.effortLevel);
                return {
                    type: "set_effort_level_response"
                };
            }

            case "open_config_file":
                return handleOpenConfigFile(request, this.handlerContext);

            //  (~/.relay.json)
            case "get_extension_config":
                return handleGetExtensionConfig(request, this.handlerContext);

            case "update_extension_config":
                return handleUpdateExtensionConfig(request, this.handlerContext);

            case "get_agent_definition":
                return handleGetAgentDefinition(request, this.handlerContext);

            case "list_agents":
                return handleListAgents(request, this.handlerContext);

            case "list_sessions_request":
                return handleListSessions(request, this.handlerContext);

            case "update_session_meta":
                return handleUpdateSessionMeta(request as any, this.handlerContext);

            case "get_session_request":
                return handleGetSession(request, this.handlerContext);

        case "list_files_request":
            return handleListFiles(request, this.handlerContext);

        case "stat_path_request":
            return handleStatPath(request as any, this.handlerContext);

            case "exec":
                return handleExec(request, this.handlerContext);

            // case "open_claude_in_terminal":
            //     return handleOpenClaudeInTerminal(request, this.handlerContext);

            // case "get_auth_status":
            //     return handleGetAuthStatus(request, this.handlerContext);

            // case "login":
            //     return handleLogin(request, this.handlerContext);

            // case "submit_oauth_code":
            //     return handleSubmitOAuthCode(request, this.handlerContext);

            default:
                throw new Error(`Unknown request type: ${request.type}`);
        }
    }

    /**
     */
    private handleResponse(message: ResponseMessage): void {
        const handler = this.outstandingRequests.get(message.requestId);
        if (handler) {
            const response = message.response;
            if (typeof response === 'object' && response !== null && 'type' in response && response.type === "error") {
                handler.reject(new Error((response as { error: string }).error));
            } else {
                handler.resolve(response);
            }
            this.outstandingRequests.delete(message.requestId);
        } else {
            this.logService.warn(`[ClaudeAgentService] : ${message.requestId}`);
        }
    }

    /**
     */
    private handleCancellation(requestId: string): void {
        const abortController = this.abortControllers.get(requestId);
        if (abortController) {
            abortController.abort();
            this.abortControllers.delete(requestId);
        }
    }

    /**
     */
    protected sendRequest<TRequest extends ExtensionRequest, TResponse>(
        channelId: string,
        request: TRequest
    ): Promise<TResponse> {
        const requestId = this.generateId();

        return new Promise<TResponse>((resolve, reject) => {
            //  Promise handlers
            this.outstandingRequests.set(requestId, { resolve, reject });

            this.transport!.send({
                type: "request",
                channelId,
                requestId,
                request
            } as RequestMessage);
        }).finally(() => {
            this.outstandingRequests.delete(requestId);
        });
    }

    /**
     */
    protected async requestToolPermission(
        channelId: string,
        toolName: string,
        inputs: Record<string, unknown>,
        suggestions: PermissionUpdate[],
        agentName?: string
    ): Promise<PermissionResult> {
        const request: ToolPermissionRequest = {
            type: "tool_permission_request",
            toolName,
            inputs,
            suggestions,
            ...(agentName ? { agentName } : {})
        };

        const response = await this.sendRequest<ToolPermissionRequest, ToolPermissionResponse>(
            channelId,
            request
        );

        return response.result;
    }

    /**
     */
    async shutdown(): Promise<void> {
        await this.closeAllChannels();
        this.fromClientStream.done();
        this.permissionServer?.dispose();
        this.permissionServer = null;
    }

    /**
     * Lazily start the HTTP MCP permission server (shared across all PTY channels).
     */
    private async ensurePermissionServer(): Promise<RelayMcpServer> {
        if (!this.permissionServer) {
            this.logService.info('[ClaudeAgentService] starting RelayMcpServer');
            this.permissionServer = new RelayMcpServer({
                onPermission: (channelId, toolName, inputs) => {
                    this.logService.info(`[ClaudeAgentService] permission request from MCP: channel=${channelId} tool=${toolName}`);
                    return this.requestToolPermission(channelId, toolName, inputs, [], undefined);
                },
                onQuestion: async (channelId, inputs) => {
                    this.logService.info(`[ClaudeAgentService] AskUserQuestion hook: channel=${channelId}`);
                    const result = await this.requestToolPermission(channelId, 'AskUserQuestion', inputs, [], undefined);
                    if (result.behavior === 'allow' && result.updatedInput) {
                        return result.updatedInput as Record<string, unknown>;
                    }
                    throw new Error('AskUserQuestion denied');
                },
                onTurnDone: (channelId) => {
                    this.logService.info(`[ClaudeAgentService] Turn done: channel=${channelId}`);
                    this.transport?.send({ type: 'pty_turn_done', channelId });
                },
                onGetDiagnostics: async (uri?: string) => {
                    const severityMap = ['error', 'warning', 'information', 'hint'] as const;
                    if (uri) {
                        const fileUri = vscode.Uri.file(uri);
                        return vscode.languages.getDiagnostics(fileUri).map(d => ({
                            uri,
                            severity: severityMap[d.severity] ?? 'error',
                            message: d.message,
                            range: {
                                startLine: d.range.start.line + 1,
                                startColumn: d.range.start.character,
                                endLine: d.range.end.line + 1,
                                endColumn: d.range.end.character,
                            },
                            source: d.source,
                            code: typeof d.code === 'object' ? String(d.code.value) : d.code,
                        }));
                    }
                    return vscode.languages.getDiagnostics().flatMap(([fileUri, diagnostics]) =>
                        diagnostics.map(d => ({
                            uri: fileUri.fsPath,
                            severity: severityMap[d.severity] ?? 'error',
                            message: d.message,
                            range: {
                                startLine: d.range.start.line + 1,
                                startColumn: d.range.start.character,
                                endLine: d.range.end.line + 1,
                                endColumn: d.range.end.character,
                            },
                            source: d.source,
                            code: typeof d.code === 'object' ? String(d.code.value) : d.code,
                        }))
                    );
                },
                onOpenFile: async (filePath: string, startLine?: number, endLine?: number) => {
                    const uri = vscode.Uri.file(filePath);
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const editor = await vscode.window.showTextDocument(doc, { preview: false });
                    if (startLine !== undefined) {
                        const start = Math.max(startLine - 1, 0);
                        const end = endLine !== undefined ? Math.max(endLine - 1, start) : start;
                        const range = new vscode.Range(start, 0, end, 0);
                        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                        editor.selection = new vscode.Selection(range.start, range.end);
                    }
                },
                onGetCurrentSelection: async () => {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor || editor.selection.isEmpty || editor.document.uri.scheme !== 'file') {
                        return null;
                    }
                    const { document, selection } = editor;
                    return {
                        filePath: document.uri.fsPath,
                        content: document.getText(selection),
                        startLine: selection.start.line + 1,
                        endLine: selection.end.line + 1,
                        startColumn: selection.start.character,
                        endColumn: selection.end.character,
                    };
                },
                onShowDiff: async (filePath: string, newContent: string, description?: string) => {
                    const tempPath = await this.fileSystemService.createTempFile(
                        path.basename(filePath),
                        newContent
                    );
                    const leftUri = vscode.Uri.file(filePath);
                    const rightUri = vscode.Uri.file(tempPath);
                    const title = description ?? `${path.basename(filePath)} (Claude)`;
                    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, { preview: true });
                },
                log: (msg) => this.logService.info(msg),
            });
            this.permissionServerStarting = this.permissionServer.start().then(() => {
                this.logService.info(`[ClaudeAgentService] RelayMcpServer started on port ${this.permissionServer!.port}`);
            }).catch(err => {
                this.logService.error(`[ClaudeAgentService] RelayMcpServer start failed: ${err}`);
                this.permissionServer = null;
                this.permissionServerStarting = null;
                throw err;
            });
        }
        await this.permissionServerStarting;
        return this.permissionServer!;
    }

    // ========================================================================
    // ========================================================================

    /**
     *  ID
     */
    private generateId(): string {
        return Math.random().toString(36).substring(2, 15);
    }

    /**
     */
    private getCwd(): string {
        return this.workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    }

    // ── Project directory watcher (for terminal PTY sessions) ─────────────────

    private async _startProjectDirWatch(channelId: string, webviewId: string, cwd: string): Promise<void> {
        this._ptyMeta.set(channelId, { webviewId, cwd });

        const refCount = (this._cwdRefCounts.get(cwd) ?? 0) + 1;
        this._cwdRefCounts.set(cwd, refCount);
        if (refCount > 1) return; // watcher already running for this cwd

        const configDir = (await this.configService.getConfigurationDirectory())
            ?? process.env.CLAUDE_CONFIG_DIR
            ?? path.join(os.homedir(), '.claude');
        const projectDir = path.join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));

        try {
            await fsPromises.mkdir(projectDir, { recursive: true });
        } catch { /* ignore */ }

        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
        const notifiedIds = new Set<string>();

        const processFile = async (filename: string) => {
            if (!UUID_RE.test(filename)) return;
            const sessionId = filename.slice(0, -6);
            const filePath = path.join(projectDir, filename);

            let summary = '';
            try {
                const content = await fsPromises.readFile(filePath, 'utf8');
                for (const line of content.split('\n')) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.type !== 'user' || msg.isMeta) continue;
                        const c = msg.message?.content;
                        let text = typeof c === 'string' ? c
                            : Array.isArray(c) ? (c.filter((b: any) => b?.type === 'text').pop()?.text ?? '') : '';
                        text = text.trim();
                        if (text && !text.startsWith('/')) {
                            summary = text.length > 45 ? text.slice(0, 45) + '...' : text;
                            break;
                        }
                    } catch { /* malformed line */ }
                }
            } catch { return; }

            if (!summary) return;

            // Notify all PTY channels watching this cwd; the webview side filters
            // by channelId and drives the rename_tab roundtrip for the correct tab.
            for (const [chId, meta] of this._ptyMeta.entries()) {
                if (meta.cwd !== cwd) continue;
                this.transport?.send({ type: 'pty_session_id', channelId: chId, sessionId, summary });
            }

            if (!notifiedIds.has(sessionId)) {
                notifiedIds.add(sessionId);
                // Broadcast to all webviews so sessions pages refresh
                this.transport?.send({ type: 'sessions_changed' });
            }
        };

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        try {
            const watcher = fs.watch(projectDir, (_, filename) => {
                if (!filename) return;
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    debounceTimer = null;
                    void processFile(filename);
                }, 300);
            });
            watcher.on('error', (err) => {
                this.logService.warn(`[ClaudeAgentService] dir watcher error cwd=${cwd}: ${err}`);
            });
            this._cwdWatchers.set(cwd, watcher);
            this.logService.info(`[ClaudeAgentService] watching ${projectDir}`);
        } catch (err) {
            this.logService.warn(`[ClaudeAgentService] failed to watch ${projectDir}: ${err}`);
        }
    }

    private _stopProjectDirWatch(channelId: string): void {
        const meta = this._ptyMeta.get(channelId);
        if (!meta) return;
        this._ptyMeta.delete(channelId);

        const { cwd } = meta;
        const refCount = (this._cwdRefCounts.get(cwd) ?? 1) - 1;
        if (refCount <= 0) {
            this._cwdRefCounts.delete(cwd);
            const watcher = this._cwdWatchers.get(cwd);
            if (watcher) {
                watcher.close();
                this._cwdWatchers.delete(cwd);
                this.logService.info(`[ClaudeAgentService] stopped watching cwd=${cwd}`);
            }
        } else {
            this._cwdRefCounts.set(cwd, refCount);
        }
    }

    private getThinkingConfig(level: string, model: string | null): ThinkingConfig {
        if (model?.toLowerCase().includes('haiku')) return { type: 'disabled' };
        return level === 'off' ? { type: 'disabled' } : { type: 'adaptive' };
    }

    /**
     *  thinking level
     */
    async setThinkingLevel(channelId: string, level: string): Promise<void> {
        this.thinkingLevel = level;

        const channel = this.channels.get(channelId);
        if (channel?.query) {
            // No setThinking() on Query yet — use deprecated setMaxThinkingTokens
            // (0 = disabled, null = adaptive default).
            const maxTokens = level === 'off' ? 0 : null;
            await channel.query.setMaxThinkingTokens(maxTokens);
            this.logService.info(`[setThinkingLevel] Updated channel ${channelId} to ${level}`);
        }
    }

    /**
     *  effort levelOpus 4.6+ adaptive reasoning
     *
     * Claude Agent SDK  effort setter CLAUDE_CODE_EFFORT_LEVEL
     *  launchClaude  CLI service
     */
    async setEffortLevel(_channelId: string, level: string): Promise<void> {
        this.effortLevel = level;
        this.logService.info(`[setEffortLevel] Stored effort level: ${level} (applied on next launch)`);
    }

    /**
     */
    async setPermissionMode(channelId: string, mode: PermissionMode): Promise<void> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            this.logService.warn(`[setPermissionMode] Channel ${channelId} not found`);
            throw new Error(`Channel ${channelId} not found`);
        }

        await channel.query.setPermissionMode(mode);
        this.logService.info(`[setPermissionMode] Set channel ${channelId} to mode: ${mode}`);
    }

    /**
     */
    async setModel(channelId: string, model: string): Promise<void> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            this.logService.warn(`[setModel] Channel ${channelId} not found`);
            throw new Error(`Channel ${channelId} not found`);
        }

        //  channel
        await channel.query.setModel(model);

        this.logService.info(`[setModel] Set channel ${channelId} to model: ${model}`);
    }

}
