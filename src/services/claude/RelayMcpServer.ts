/**
 * RelayMcpServer
 *
 * A minimal HTTP MCP server started once when the extension activates.
 * The Claude Code CLI connects to it directly via --permission-prompt-tool
 * instead of prompting interactively in the terminal.
 *
 * Security model:
 *   channelId — embedded directly in the URL path: /mcp/<channelId>
 *               The channelId is generated from Math.random().toString(36)
 *               and is only valid for the lifetime of its PTY channel.
 *               Binding to 127.0.0.1 limits exposure to the local machine.
 *               No Authorization header is required, avoiding CLI header-
 *               forwarding limitations.
 *
 * MCP protocol:
 *   Implements the Streamable HTTP transport (type: "http" in mcp-config).
 *   All methods are stateless — no session IDs. Responds synchronously to
 *   initialize, tools/list, and tools/call; holds the tools/call response
 *   open until the user approves or denies in the webview modal.
 */

import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

export type PermissionCallback = (
    channelId: string,
    toolName: string,
    inputs: Record<string, unknown>
) => Promise<PermissionResult>;

export type QuestionCallback = (
    channelId: string,
    inputs: Record<string, unknown>
) => Promise<Record<string, unknown>>;

export type TurnDoneCallback = (channelId: string) => void;

export interface DiagnosticEntry {
    uri: string;
    severity: 'error' | 'warning' | 'information' | 'hint';
    message: string;
    range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
    source?: string;
    code?: string | number;
}

export interface SelectionEntry {
    filePath: string;
    content: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
}

export type GetDiagnosticsCallback = (uri?: string) => Promise<DiagnosticEntry[]>;
export type OpenFileCallback = (filePath: string, startLine?: number, endLine?: number) => Promise<void>;
export type GetSelectionCallback = () => Promise<SelectionEntry | null>;
export type ShowDiffCallback = (filePath: string, newContent: string, description?: string) => Promise<void>;

export interface RelayMcpServerOptions {
    onPermission: PermissionCallback;
    onQuestion: QuestionCallback;
    onTurnDone?: TurnDoneCallback;
    onGetDiagnostics?: GetDiagnosticsCallback;
    onOpenFile?: OpenFileCallback;
    onGetCurrentSelection?: GetSelectionCallback;
    onShowDiff?: ShowDiffCallback;
    log?: (msg: string) => void;
}

const PERMISSION_TOOL = {
    name: 'permission_prompt',
    description: 'Request user permission before a tool is executed',
    inputSchema: {
        type: 'object',
        properties: {
            tool_name: { type: 'string', description: 'Name of the tool requesting permission' },
            input: { type: 'object', description: 'Inputs the tool will use' },
            tool_description: { type: 'string', description: 'Human-readable description of the operation' },
        },
        required: ['tool_name', 'input'],
    },
};

const ASK_USER_QUESTION_TOOL = {
    name: 'ask_user_question',
    description: 'Show an AskUserQuestion prompt in the Relay webview modal and return the answers',
    inputSchema: {
        type: 'object',
        properties: {
            questions: { type: 'array', description: 'Questions array from the AskUserQuestion tool input' },
        },
        required: ['questions'],
    },
};

const EXIT_PLAN_MODE_TOOL = {
    name: 'exit_plan_mode',
    description: 'Show the ExitPlanMode plan-review modal in the Relay webview and return the user decision',
    inputSchema: {
        type: 'object',
        properties: {
            plan: { type: 'string', description: 'The plan markdown from the ExitPlanMode tool input' },
        },
        required: ['plan'],
    },
};

const NOTIFY_TURN_DONE_TOOL = {
    name: 'notify_turn_done',
    description: 'Notify Relay that the current Claude response turn has completed',
    inputSchema: { type: 'object', properties: {} },
};

const GET_DIAGNOSTICS_TOOL = {
    name: 'getDiagnostics',
    description: 'Get diagnostics (errors and warnings) from VS Code for the workspace or a specific file',
    inputSchema: {
        type: 'object',
        properties: {
            uri: {
                type: 'string',
                description: 'Optional absolute file path to scope diagnostics. Omit to return all workspace diagnostics.',
            },
        },
    },
};

const OPEN_FILE_TOOL = {
    name: 'openFile',
    description: 'Open a file in the VS Code editor, optionally scrolling to a specific line range',
    inputSchema: {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'Absolute or workspace-relative path to the file' },
            startLine: { type: 'number', description: '1-based line number to reveal and start selection' },
            endLine: { type: 'number', description: '1-based line number to end selection (defaults to startLine)' },
        },
        required: ['filePath'],
    },
};

const GET_CURRENT_SELECTION_TOOL = {
    name: 'getCurrentSelection',
    description: 'Return the text currently selected in the active VS Code editor, along with its file path and line range',
    inputSchema: { type: 'object', properties: {} },
};

const SHOW_DIFF_TOOL = {
    name: 'showDiff',
    description: 'Open VS Code\'s diff viewer comparing the current file on disk with proposed new content',
    inputSchema: {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'Absolute path to the file to compare' },
            newContent: { type: 'string', description: 'Proposed new content to show on the right side of the diff' },
            description: { type: 'string', description: 'Optional title for the diff tab' },
        },
        required: ['filePath', 'newContent'],
    },
};

export class RelayMcpServer {
    private server: http.Server | null = null;
    private _port = 0;

    private readonly activeChannels = new Set<string>();
    private readonly tempFiles = new Set<string>();

    private readonly onPermission: PermissionCallback;
    private readonly onQuestion: QuestionCallback;
    private readonly onTurnDone: TurnDoneCallback | undefined;
    private readonly onGetDiagnostics: GetDiagnosticsCallback | undefined;
    private readonly onOpenFile: OpenFileCallback | undefined;
    private readonly onGetCurrentSelection: GetSelectionCallback | undefined;
    private readonly onShowDiff: ShowDiffCallback | undefined;
    private readonly log: (msg: string) => void;

    constructor(options: RelayMcpServerOptions) {
        this.onPermission = options.onPermission;
        this.onQuestion = options.onQuestion;
        this.onTurnDone = options.onTurnDone;
        this.onGetDiagnostics = options.onGetDiagnostics;
        this.onOpenFile = options.onOpenFile;
        this.onGetCurrentSelection = options.onGetCurrentSelection;
        this.onShowDiff = options.onShowDiff;
        this.log = options.log ?? (() => {});
    }

    get port(): number { return this._port; }

    async start(): Promise<void> {
        this.server = http.createServer((req, res) => {
            this._handle(req, res).catch(err => {
                if (!res.headersSent) res.writeHead(500).end(String(err));
            });
        });
        await new Promise<void>((resolve, reject) => {
            this.server!.listen(0, '127.0.0.1', () => resolve());
            this.server!.once('error', reject);
        });
        this._port = (this.server.address() as net.AddressInfo).port;
        this.log(`[RelayMcpServer] listening on port ${this._port}`);
    }

    /**
     * Write the per-channel MCP config JSON.  The CLI reads this file to
     * discover the server URL for this channel.  The channelId is embedded
     * directly in the URL path — no extra token needed.
     */
    async writeMcpConfig(channelId: string): Promise<string> {
        this.activeChannels.add(channelId);

        const url = `http://127.0.0.1:${this._port}/mcp/${channelId}`;
        const config = {
            mcpServers: {
                relay: {
                    type: 'http',
                    url,
                },
            },
        };

        const configPath = path.join(os.tmpdir(), `relay-mcp-${channelId}.json`);
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
        this.tempFiles.add(configPath);
        this.log(`[RelayMcpServer] wrote MCP config for channel=${channelId} url=${url} path=${configPath}`);
        return configPath;
    }

    async cleanupChannel(channelId: string): Promise<void> {
        this.activeChannels.delete(channelId);
        const configPath = path.join(os.tmpdir(), `relay-mcp-${channelId}.json`);
        this.tempFiles.delete(configPath);
        try { await fs.unlink(configPath); } catch { /* already gone */ }
    }

    dispose(): void {
        this.server?.close();
        this.server = null;
        for (const file of this.tempFiles) fs.unlink(file).catch(() => {});
        this.tempFiles.clear();
        this.activeChannels.clear();
    }

    // ── Private ──────────────────────────────────────────────────────────────

    /** Extract channelId from URL path /mcp/<channelId>. Returns null if unknown. */
    private _authenticate(url: string | undefined): string | null {
        if (!url) return null;
        const match = url.match(/^\/mcp\/([0-9a-z]+)(?:\?.*)?$/i);
        if (!match) return null;
        const channelId = match[1];
        return this.activeChannels.has(channelId) ? channelId : null;
    }

    private async _handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        this.log(`[RelayMcpServer] ${req.method} ${req.url}`);
        // GET is for the optional SSE notification stream — we don't support it
        if (req.method === 'GET') { res.writeHead(405).end(); return; }
        if (req.method !== 'POST') { res.writeHead(405).end(); return; }

        const channelId = this._authenticate(req.url);
        if (channelId === null) {
            this.log(`[RelayMcpServer] 401 Unauthorized — unknown token in ${req.url}`);
            res.writeHead(401).end('Unauthorized');
            return;
        }
        this.log(`[RelayMcpServer] authenticated channel=${channelId}`);

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>(resolve => req.on('end', resolve));

        let msg: Record<string, unknown>;
        try {
            msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
            res.writeHead(400).end('Bad Request');
            return;
        }

        await this._dispatch(msg, channelId, res);
    }

    private async _dispatch(
        msg: Record<string, unknown>,
        channelId: string,
        res: http.ServerResponse
    ): Promise<void> {
        const id = msg['id'];

        const ok = (result: unknown) => {
            const body = JSON.stringify({ jsonrpc: '2.0', id, result });
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(body);
        };

        const err = (code: number, message: string) => {
            const body = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(body);
        };

        const toolOk = (data: unknown) => ok({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });
        const toolErr = (message: string) => ok({ content: [{ type: 'text', text: message }], isError: true });

        // Notifications have no id — just acknowledge.
        if (id === undefined || id === null) {
            this.log(`[RelayMcpServer] notification (no id), method=${msg['method']}`);
            res.writeHead(202).end();
            return;
        }

        const method = msg['method'];
        this.log(`[RelayMcpServer] dispatch id=${id} method=${method} channel=${channelId}`);

        if (method === 'initialize') {
            ok({
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'relay-permission', version: '1.0.0' },
            });
            return;
        }

        if (method === 'tools/list') {
            const tools = [
                PERMISSION_TOOL,
                ASK_USER_QUESTION_TOOL,
                EXIT_PLAN_MODE_TOOL,
                NOTIFY_TURN_DONE_TOOL,
                GET_DIAGNOSTICS_TOOL,
                OPEN_FILE_TOOL,
                GET_CURRENT_SELECTION_TOOL,
                SHOW_DIFF_TOOL,
            ];
            ok({ tools });
            return;
        }

        if (method === 'tools/call') {
            const params = msg['params'] as Record<string, unknown> | undefined;
            const toolName = params?.['name'];
            this.log(`[RelayMcpServer] tools/call name=${toolName} channel=${channelId}`);
            const args = (params?.['arguments'] ?? {}) as Record<string, unknown>;

            if (toolName === 'permission_prompt') {
                const requestedTool = (args['tool_name'] as string) || 'unknown';
                const inputs = (args['input'] as Record<string, unknown>) || {};
                this.log(`[RelayMcpServer] permission_prompt requesting tool=${requestedTool} channel=${channelId}`);
                try {
                    const result = await this.onPermission(channelId, requestedTool, inputs);
                    this.log(`[RelayMcpServer] permission_prompt result=${JSON.stringify(result)} channel=${channelId}`);
                    const decision: Record<string, unknown> = { behavior: result.behavior };
                    if (result.behavior === 'deny') {
                        const msg = (result as { behavior: 'deny'; message?: string }).message;
                        if (msg) decision['message'] = msg;
                    }
                    ok({ content: [{ type: 'text', text: JSON.stringify(decision) }], isError: false });
                } catch {
                    ok({ content: [{ type: 'text', text: '{"behavior":"deny","message":"Internal error"}' }], isError: false });
                }
                return;
            }

            if (toolName === 'ask_user_question') {
                this.log(`[RelayMcpServer] ask_user_question channel=${channelId}`);
                try {
                    const updatedInput = await this.onQuestion(channelId, args);
                    const decision = { permissionDecision: 'allow', updatedInput };
                    ok({ content: [{ type: 'text', text: JSON.stringify(decision) }], isError: false });
                } catch {
                    ok({ content: [{ type: 'text', text: '{"permissionDecision":"deny"}' }], isError: false });
                }
                return;
            }

            if (toolName === 'exit_plan_mode') {
                this.log(`[RelayMcpServer] exit_plan_mode channel=${channelId}`);
                try {
                    const result = await this.onPermission(channelId, 'ExitPlanMode', args);
                    const decision = { permissionDecision: result.behavior === 'allow' ? 'allow' : 'deny' };
                    ok({ content: [{ type: 'text', text: JSON.stringify(decision) }], isError: false });
                } catch {
                    ok({ content: [{ type: 'text', text: '{"permissionDecision":"deny"}' }], isError: false });
                }
                return;
            }

            if (toolName === 'notify_turn_done') {
                this.log(`[RelayMcpServer] notify_turn_done channel=${channelId}`);
                if (this.onTurnDone) this.onTurnDone(channelId);
                ok({ content: [{ type: 'text', text: '{"status":"ok"}' }], isError: false });
                return;
            }

            if (toolName === 'getDiagnostics') {
                this.log(`[RelayMcpServer] getDiagnostics channel=${channelId}`);
                if (!this.onGetDiagnostics) { toolErr('getDiagnostics not supported'); return; }
                try {
                    const uri = args['uri'] as string | undefined;
                    const diagnostics = await this.onGetDiagnostics(uri);
                    toolOk(diagnostics);
                } catch (e) {
                    toolErr(String(e));
                }
                return;
            }

            if (toolName === 'openFile') {
                this.log(`[RelayMcpServer] openFile channel=${channelId}`);
                if (!this.onOpenFile) { toolErr('openFile not supported'); return; }
                try {
                    const filePath = args['filePath'] as string;
                    const startLine = args['startLine'] as number | undefined;
                    const endLine = args['endLine'] as number | undefined;
                    await this.onOpenFile(filePath, startLine, endLine);
                    toolOk({ success: true });
                } catch (e) {
                    toolErr(String(e));
                }
                return;
            }

            if (toolName === 'getCurrentSelection') {
                this.log(`[RelayMcpServer] getCurrentSelection channel=${channelId}`);
                if (!this.onGetCurrentSelection) { toolErr('getCurrentSelection not supported'); return; }
                try {
                    const selection = await this.onGetCurrentSelection();
                    toolOk(selection);
                } catch (e) {
                    toolErr(String(e));
                }
                return;
            }

            if (toolName === 'showDiff') {
                this.log(`[RelayMcpServer] showDiff channel=${channelId}`);
                if (!this.onShowDiff) { toolErr('showDiff not supported'); return; }
                try {
                    const filePath = args['filePath'] as string;
                    const newContent = args['newContent'] as string;
                    const description = args['description'] as string | undefined;
                    await this.onShowDiff(filePath, newContent, description);
                    toolOk({ success: true });
                } catch (e) {
                    toolErr(String(e));
                }
                return;
            }

            err(-32601, 'Unknown tool');
            return;
        }

        err(-32601, 'Method not found');
    }
}
