/**
 * ClaudeProcessService - Direct Claude CLI process integration
 *
 * Replaces the @anthropic-ai/claude-agent-sdk by spawning the Claude CLI
 * directly with --output-format stream-json --input-format stream-json.
 *
 * Wire protocol (JSON Lines on stdio):
 *   stdout: SDKMessage | {type:'control_request', request_id, request} | {type:'keep_alive'}
 *   stdin:  SDKUserMessage | {type:'control_request', request_id, request} | {type:'control_response', response}
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { spawn, type ChildProcess } from 'child_process';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { IConfigurationService } from '../configurationService';
import { IFileSystemService } from '../fileSystemService';
import { AsyncStream } from './transport';
import type {
    CanUseTool,
    PermissionMode,
    PermissionResult,
    SDKMessage,
    SDKUserMessage,
    ThinkingConfig,
} from '@anthropic-ai/claude-agent-sdk';
import type { Query } from './claudeTypes';

export const IClaudeSdkService = createDecorator<IClaudeSdkService>('claudeSdkService');

export interface LLMRequestError {
    statusCode: string;
    message: string;
    type: string;
    raw: string;
}

export interface SdkQueryParams {
    inputStream: AsyncStream<SDKUserMessage>;
    resume: string | null;
    canUseTool: CanUseTool;
    model: string | null;
    agent?: string | null;
    cwd: string;
    permissionMode: PermissionMode | string;
    thinking?: ThinkingConfig;
    effortLevel?: string | null;
    onStderrError?: (error: LLMRequestError) => void;
}

export interface SdkProbeParams {
    capabilities: string[];
    cwd: string;
    timeoutMs?: number;
}

export interface SdkProbeResult {
    data: Record<string, unknown>;
    errors?: Record<string, string>;
}

export interface IClaudeSdkService {
    readonly _serviceBrand: undefined;
    query(params: SdkQueryParams): Promise<Query>;
    probe(params: SdkProbeParams): Promise<SdkProbeResult>;
    interrupt(query: Query): Promise<void>;
}

const VS_CODE_APPEND_PROMPT = `
  # VSCode Extension Context

  You are running inside a VSCode native extension environment.

  ## Code References in Text
  IMPORTANT: When referencing files or code locations, use markdown link syntax to make them clickable:
  - For files: [filename.ts](src/filename.ts)
  - For specific lines: [filename.ts:42](src/filename.ts#L42)
  - For a range of lines: [filename.ts:42-51](src/filename.ts#L42-L51)
  - For folders: [src/utils/](src/utils/)
  Unless explicitly asked for by the user, DO NOT USE backtickets \` or HTML tags like code for file references - always use markdown [text](link) format.
  The URL links should be relative paths from the root of  the user's workspace.

  ## User Selection Context
  The user's IDE selection (if any) is included in the conversation context and marked with ide_selection tags. This represents code or text the user has highlighted in their editor and may or may not be relevant to their request.`;

// ---------------------------------------------------------------------------
// ProcessQuery — wraps a spawned CLI child process as a Query
// ---------------------------------------------------------------------------

class ProcessQuery implements Query {
    private readonly messageQueue: Array<SDKMessage | Error | null> = [];
    private readonly waiters: Array<{
        resolve: (v: IteratorResult<SDKMessage, void>) => void;
        reject: (e: unknown) => void;
    }> = [];
    private isDone = false;
    private initResponse: Record<string, unknown> | null = null;
    private initWaiters: Array<() => void> = [];
    private readonly pendingControl = new Map<string, {
        resolve: (v: unknown) => void;
        reject: (e: Error) => void;
    }>();

    constructor(
        private readonly proc: ChildProcess,
        private readonly canUseTool: CanUseTool | undefined,
        private readonly logService: ILogService
    ) {
        this.setupReaders();
    }

    // ── stdout / stdin wiring ──────────────────────────────────────────────

    private setupReaders(): void {
        const rl = readline.createInterface({ input: this.proc.stdout! });
        rl.on('line', (line: string) => {
            if (!line.trim()) return;
            let parsed: Record<string, unknown>;
            try { parsed = JSON.parse(line); }
            catch { return; }
            this.handleStdoutMessage(parsed);
        });
        rl.on('close', () => this.signalDone());
        this.proc.on('error', (err: Error) => this.signalError(err));
        // process exit without readline close (edge case)
        this.proc.on('close', () => this.signalDone());
    }

    private handleStdoutMessage(msg: Record<string, unknown>): void {
        const type = msg.type as string;

        if (type === 'control_request') {
            void this.handleInboundControlRequest(
                msg as { type: string; request_id: string; request: Record<string, unknown> }
            );
        } else if (type === 'control_response') {
            // The CLI is acking one of our outbound control requests
            const response = msg.response as Record<string, unknown> | undefined;
            const requestId = response?.request_id as string | undefined;
            if (requestId && this.pendingControl.has(requestId)) {
                const handler = this.pendingControl.get(requestId)!;
                this.pendingControl.delete(requestId);
                handler.resolve(response);
            }
        } else if (type === 'keep_alive') {
            // nothing
        } else {
            // Capture the system init message for probe methods
            if (type === 'system' && (msg.subtype as string) === 'init' && !this.initResponse) {
                this.initResponse = msg;
                this.initWaiters.forEach(r => r());
                this.initWaiters = [];
            }
            this.enqueueMessage(msg as unknown as SDKMessage);
        }
    }

    private async handleInboundControlRequest(msg: {
        type: string;
        request_id: string;
        request: Record<string, unknown>;
    }): Promise<void> {
        const { request_id, request } = msg;

        if (request.subtype === 'can_use_tool' && this.canUseTool) {
            try {
                const result: PermissionResult = await this.canUseTool(
                    request.tool_name as string,
                    (request.input ?? {}) as Record<string, unknown>,
                    {
                        signal: new AbortController().signal,
                        suggestions: request.permission_suggestions as any,
                        blockedPath: request.blocked_path as string | undefined,
                        decisionReason: request.decision_reason as string | undefined,
                        title: request.title as string | undefined,
                        displayName: request.display_name as string | undefined,
                        description: request.description as string | undefined,
                        toolUseID: (request.tool_use_id ?? '') as string,
                        agentID: request.agent_id as string | undefined,
                    }
                );
                this.writeStdin({
                    type: 'control_response',
                    response: { subtype: 'success', request_id, response: result }
                });
            } catch (err) {
                this.writeStdin({
                    type: 'control_response',
                    response: {
                        subtype: 'success',
                        request_id,
                        response: { behavior: 'deny', message: String(err) }
                    }
                });
            }
        } else {
            // Ack unrecognised control requests so the CLI doesn't stall
            this.writeStdin({
                type: 'control_response',
                response: { subtype: 'success', request_id }
            });
        }
    }

    private writeStdin(msg: object): void {
        if (this.proc.stdin && !this.proc.stdin.destroyed) {
            this.proc.stdin.write(JSON.stringify(msg) + '\n');
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /** Write a user message to the CLI via stdin. */
    send(msg: SDKUserMessage): void {
        this.writeStdin(msg);
    }

    async interrupt(): Promise<void> {
        if (!this.proc.killed) {
            this.proc.kill('SIGINT');
        }
    }

    async setPermissionMode(mode: PermissionMode): Promise<void> {
        await this.sendControl({ subtype: 'set_permission_mode', mode });
    }

    async setModel(model: string): Promise<void> {
        await this.sendControl({ subtype: 'set_model', model });
    }

    async setMaxThinkingTokens(max: number | null): Promise<void> {
        await this.sendControl({ subtype: 'set_max_thinking_tokens', max_thinking_tokens: max });
    }

    /** Wait up to timeoutMs for the CLI system init message, then return initResponse. */
    private waitForInit(timeoutMs = 5_000): Promise<Record<string, unknown> | null> {
        if (this.initResponse || this.isDone) return Promise.resolve(this.initResponse);
        return new Promise<Record<string, unknown> | null>((resolve) => {
            const timer = setTimeout(() => {
                this.initWaiters = this.initWaiters.filter(r => r !== done);
                resolve(null);
            }, timeoutMs);
            const done = () => { clearTimeout(timer); resolve(this.initResponse); };
            this.initWaiters.push(done);
        });
    }

    // Methods used by loadConfig() in handlers.ts via (query as any).xxx?.()
    async supportedCommands(): Promise<unknown[]> {
        const init = await this.waitForInit();
        return (init?.tools as unknown[]) ?? [];
    }

    async supportedModels(): Promise<unknown[]> {
        const init = await this.waitForInit();
        return (init?.models as unknown[]) ?? [];
    }

    async accountInfo(): Promise<unknown> {
        const init = await this.waitForInit();
        return init?.account_info ?? null;
    }

    async mcpServerStatus(): Promise<unknown[]> {
        const init = await this.waitForInit();
        return (init?.mcp_servers as unknown[]) ?? [];
    }

    // ── Control request/response ───────────────────────────────────────────

    private sendControl(request: object): Promise<unknown> {
        const requestId = `ctrl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingControl.has(requestId)) {
                    this.pendingControl.delete(requestId);
                    reject(new Error(`Control request timed out: ${JSON.stringify(request)}`));
                }
            }, 30_000);

            this.pendingControl.set(requestId, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); },
            });

            this.writeStdin({ type: 'control_request', request_id: requestId, request });
        });
    }

    // ── AsyncIterator implementation ───────────────────────────────────────

    private enqueueMessage(msg: SDKMessage): void {
        if (this.waiters.length > 0) {
            const waiter = this.waiters.shift()!;
            waiter.resolve({ done: false, value: msg });
        } else {
            this.messageQueue.push(msg);
        }
    }

    private signalDone(): void {
        if (this.isDone) return;
        this.isDone = true;
        this.initWaiters.forEach(r => r());
        this.initWaiters = [];
        this.messageQueue.push(null);
        this.flushWaiters();
    }

    private signalError(err: Error): void {
        if (this.isDone) return;
        this.isDone = true;
        this.initWaiters.forEach(r => r());
        this.initWaiters = [];
        this.messageQueue.push(err);
        this.flushWaiters();
    }

    private flushWaiters(): void {
        while (this.waiters.length > 0) {
            const item = this.messageQueue.shift();
            const waiter = this.waiters.shift()!;
            if (item == null) {
                waiter.resolve({ done: true, value: undefined });
            } else if (item instanceof Error) {
                waiter.reject(item);
            } else {
                waiter.resolve({ done: false, value: item });
            }
        }
    }

    async next(): Promise<IteratorResult<SDKMessage, void>> {
        if (this.messageQueue.length > 0) {
            const item = this.messageQueue.shift()!;
            if (item === null) return { done: true, value: undefined };
            if (item instanceof Error) throw item;
            return { done: false, value: item };
        }
        if (this.isDone) return { done: true, value: undefined };
        return new Promise<IteratorResult<SDKMessage, void>>((resolve, reject) => {
            this.waiters.push({ resolve, reject });
        });
    }

    async return(_value?: unknown): Promise<IteratorResult<SDKMessage, void>> {
        if (!this.proc.killed) {
            this.proc.kill('SIGTERM');
        }
        this.signalDone();
        // Reject any pending outbound control requests
        for (const handler of this.pendingControl.values()) {
            handler.reject(new Error('Process terminated'));
        }
        this.pendingControl.clear();
        return { done: true, value: undefined };
    }

    async throw(error: unknown): Promise<IteratorResult<SDKMessage, void>> {
        const err = error instanceof Error ? error : new Error(String(error));
        this.signalError(err);
        throw error;
    }

    [Symbol.asyncIterator](): AsyncIterator<SDKMessage, void> {
        return this;
    }
}

// ---------------------------------------------------------------------------
// ClaudeSdkService — IClaudeSdkService implementation
// ---------------------------------------------------------------------------

export class ClaudeSdkService implements IClaudeSdkService {
    readonly _serviceBrand: undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        @ILogService private readonly logService: ILogService,
        @IConfigurationService private readonly configService: IConfigurationService,
        @IFileSystemService private readonly fileSystemService: IFileSystemService
    ) {
        this.logService.info('[ClaudeProcessService] initialised');
    }

    async query(params: SdkQueryParams): Promise<Query> {
        const {
            inputStream, resume, canUseTool, model, agent, cwd,
            permissionMode, thinking, effortLevel, onStderrError
        } = params;

        this.logService.info('========================================');
        this.logService.info('ClaudeProcessService.query()');
        this.logService.info('========================================');
        this.logService.info(`  model: ${model}, agent: ${agent ?? 'none'}, cwd: ${cwd}`);
        this.logService.info(`  permissionMode: ${permissionMode}, resume: ${resume}`);
        this.logService.info(`  thinking: ${JSON.stringify(thinking)}, effortLevel: ${effortLevel ?? 'none'}`);

        const cliPath = await this.getClaudeExecutablePath();
        const env = await this.getMergedEnvironmentVariables();

        const relayDir = env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
        const relayPath = path.join(relayDir, 'relay.json');

        if (effortLevel && !env.CLAUDE_CODE_EFFORT_LEVEL) {
            env.CLAUDE_CODE_EFFORT_LEVEL = effortLevel;
        }

        // Only verify existence for absolute paths; bare command names (e.g. "claude") are
        // resolved by the OS at spawn time.
        if (path.isAbsolute(cliPath) && !(await this.fileSystemService.pathExists(cliPath))) {
            throw new Error(`Claude CLI not found at: ${cliPath}`);
        }

        const modelParam = model === null ? 'default' : model;

        const args: string[] = [
            '--output-format', 'stream-json',
            '--verbose',
            '--input-format', 'stream-json',
            '--model', modelParam,
            '--permission-mode', permissionMode as string,
            '--setting-sources=',
            '--settings', relayPath,
            '--debug-to-stderr',
            '--include-partial-messages',
        ];

        if (resume) args.push('--resume', resume);
        if (agent) args.push('--agent', agent);

        if (thinking?.type === 'disabled') {
            args.push('--thinking', 'disabled');
        } else {
            args.push('--thinking', 'adaptive');
        }

        args.push('--append-system-prompt', VS_CODE_APPEND_PROMPT);

        process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-vscode';

        this.logService.info(`CLI: ${cliPath}`);
        this.logService.info(`Args: ${args.join(' ')}`);

        const isJs = cliPath.endsWith('.js');
        const spawnCmd = isJs ? process.execPath : cliPath;
        const spawnArgs = isJs ? [cliPath, ...args] : args;

        const proc = spawn(spawnCmd, spawnArgs, {
            cwd,
            env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.logService.info(`Spawned CLI pid=${proc.pid}`);

        // Pipe stderr through the same error parsing as before
        if (proc.stderr) {
            const stderrRl = readline.createInterface({ input: proc.stderr });
            stderrRl.on('line', (line: string) => {
                if (!line.trim()) return;
                const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
                const lowerLine = line.toLowerCase();
                let level = 'INFO';
                if (lowerLine.includes('error') || lowerLine.includes('failed') || lowerLine.includes('exception')) {
                    level = 'ERROR';
                } else if (lowerLine.includes('warn') || lowerLine.includes('warning')) {
                    level = 'WARN';
                } else if (lowerLine.includes('exit') || lowerLine.includes('terminated')) {
                    level = 'EXIT';
                }
                this.logService.info(`[${timestamp}] [CLI ${level}] ${line}`);

                if (onStderrError) {
                    const m = line.match(/Error streaming, falling back to non-streaming mode:\s*(\d+)\s*(.*)/);
                    if (m) {
                        const statusCode = m[1];
                        const rest = m[2];
                        let message = `HTTP ${statusCode}`;
                        let errorType = 'unknown';
                        try {
                            const jsonMatch = rest.match(/(\{[\s\S]*\})/);
                            if (jsonMatch) {
                                const parsed = JSON.parse(jsonMatch[1]);
                                const err = parsed.error || parsed;
                                message = err.message || err.msg || message;
                                errorType = err.type || err.code || errorType;
                            }
                        } catch { /* non-JSON tail */ }
                        onStderrError({ statusCode, message, type: errorType, raw: line });
                    }
                }
            });
        }

        const processQuery = new ProcessQuery(proc, canUseTool, this.logService);

        // Drain inputStream → stdin
        void (async () => {
            for await (const msg of inputStream) {
                processQuery.send(msg);
            }
        })();

        return processQuery;
    }

    async probe(params: SdkProbeParams): Promise<SdkProbeResult> {
        const capabilities = Array.from(new Set(params.capabilities ?? [])).filter(Boolean);
        if (capabilities.length === 0) return { data: {} };

        const timeoutMs = Math.max(1000, params.timeoutMs ?? 10_000);
        const data: Record<string, unknown> = {};
        const errors: Record<string, string> = {};

        let processQuery: ProcessQuery | undefined;

        try {
            await Promise.race([
                (async () => {
                    processQuery = await this.queryLite(params.cwd);
                    for (const cap of capabilities) {
                        try {
                            switch (cap) {
                                case 'supportedCommands':
                                    data[cap] = await processQuery.supportedCommands();
                                    break;
                                case 'supportedModels':
                                    data[cap] = await processQuery.supportedModels();
                                    break;
                                case 'mcpServerStatus':
                                    data[cap] = await processQuery.mcpServerStatus();
                                    break;
                                case 'accountInfo':
                                    data[cap] = await processQuery.accountInfo();
                                    break;
                                default:
                                    errors[cap] = 'Unsupported capability';
                            }
                        } catch (err) {
                            errors[cap] = err instanceof Error ? err.message : String(err);
                        }
                    }
                })(),
                new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error('probe timed out')), timeoutMs)
                )
            ]);
        } catch (err) {
            if (processQuery) {
                try { await processQuery.return(); } catch { /* ignore */ }
            }
            throw err;
        } finally {
            if (processQuery) {
                try { await processQuery.return(); } catch { /* ignore */ }
            }
        }

        return { data, errors: Object.keys(errors).length ? errors : undefined };
    }

    async interrupt(query: Query): Promise<void> {
        try {
            this.logService.info('🛑 interrupt');
            await query.interrupt();
            this.logService.info('✓ interrupted');
        } catch (err) {
            this.logService.error(`interrupt failed: ${err}`);
            throw err;
        }
    }

    // ── Private helpers ────────────────────────────────────────────────────

    private async queryLite(cwd: string): Promise<ProcessQuery> {
        const cliPath = await this.getClaudeExecutablePath();
        const env = await this.getMergedEnvironmentVariables();
        const relayDir = env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
        const relayPath = path.join(relayDir, 'relay.json');

        const args = [
            '--output-format', 'stream-json',
            '--verbose',
            '--input-format', 'stream-json',
            '--model', 'default',
            '--permission-mode', 'default',
            '--setting-sources=',
            '--settings', relayPath,
        ];

        const isJs = cliPath.endsWith('.js');
        const spawnCmd = isJs ? process.execPath : cliPath;
        const spawnArgs = isJs ? [cliPath, ...args] : args;

        const proc = spawn(spawnCmd, spawnArgs, { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });

        return new ProcessQuery(proc, undefined, this.logService);
    }

    private async getMergedEnvironmentVariables(): Promise<Record<string, string>> {
        const customVars = await this.configService.getEnvironmentVariables();
        const configDir = await this.configService.getConfigurationDirectory();

        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
            if (v !== undefined) env[k] = v;
        }

        this.logService.info(`[ClaudeProcessService] configDir: ${configDir ?? '(not set)'}`);
        if (configDir) {
            env.CLAUDE_CONFIG_DIR = configDir;
        }

        return { ...env, ...customVars };
    }

    private async getClaudeExecutablePath(): Promise<string> {
        const configured = vscode.workspace.getConfiguration('relay').get<string>('claudeExecutablePath', '').trim();
        if (configured) {
            return configured;
        }
        return 'claude';
    }
}
