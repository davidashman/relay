/**
 * ClaudeTerminalService — manages PTY sessions for integrated terminal mode.
 *
 * Rather than loading node-pty in the Electron extension host (where native
 * ABI mismatches cause failures), each channel spawns a tiny bridge script
 * (resources/pty-bridge.cjs) under the system `node` binary.  The bridge
 * loads node-pty with the correct prebuilt for the system Node.js ABI, then
 * forwards I/O back to the extension host via newline-delimited JSON on
 * stdin/stdout.
 */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { createDecorator } from '../../di/instantiation';
import { IConfigurationService } from '../configurationService';
import { IFileSystemService } from '../fileSystemService';
import { ILogService } from '../logService';

export const IClaudeTerminalService = createDecorator<IClaudeTerminalService>('claudeTerminalService');

export interface PtySpawnOptions {
    channelId: string;
    resume?: string | null;
    agent?: string | null;
    permissionMode?: string;
    model?: string | null;
    effortLevel?: string | null;
    cwd: string;
    cols: number;
    rows: number;
    /** Path to the temp MCP config JSON pointing to the extension's HTTP permission server. */
    mcpConfigPath?: string;
}

export interface IClaudeTerminalService {
    readonly _serviceBrand: undefined;
    spawn(opts: PtySpawnOptions): Promise<void>;
    write(channelId: string, data: string): void;
    resize(channelId: string, cols: number, rows: number): void;
    kill(channelId: string): void;
    onData(handler: (channelId: string, data: string) => void): void;
    onExit(handler: (channelId: string, exitCode: number) => void): void;
}

export class ClaudeTerminalService implements IClaudeTerminalService {
    readonly _serviceBrand: undefined;

    private readonly _bridges = new Map<string, child_process.ChildProcess>();
    private _dataHandler?: (channelId: string, data: string) => void;
    private _exitHandler?: (channelId: string, exitCode: number) => void;

    constructor(
        private readonly context: vscode.ExtensionContext,
        @ILogService private readonly logService: ILogService,
        @IConfigurationService private readonly configService: IConfigurationService,
        @IFileSystemService private readonly fileSystemService: IFileSystemService,
    ) {}

    async spawn(opts: PtySpawnOptions): Promise<void> {
        const { channelId, resume, agent, permissionMode, model, effortLevel, cwd, cols, rows, mcpConfigPath } = opts;

        // Write a temporary Claude settings file that registers a PreToolUse hook
        // for AskUserQuestion. The hook calls the ask_user_question tool on the
        // already-connected relay MCP server, which shows the AskUserQuestionModal
        // in the webview and returns the user's answers without any TTY prompting.
        let hookSettingsPath: string | undefined;
        if (mcpConfigPath) {
            const hookSettings = {
                hooks: {
                    PreToolUse: [
                        {
                            matcher: 'AskUserQuestion',
                            hooks: [{
                                type: 'mcp_tool',
                                server: 'relay',
                                tool: 'ask_user_question',
                                input: { questions: '${tool_input.questions}' },
                            }],
                        },
                        {
                            matcher: 'ExitPlanMode',
                            hooks: [{
                                type: 'mcp_tool',
                                server: 'relay',
                                tool: 'exit_plan_mode',
                                input: { plan: '${tool_input.plan}' },
                            }],
                        },
                    ],
                },
            };
            hookSettingsPath = path.join(os.tmpdir(), `relay-hook-settings-${channelId}.json`);
            await fs.promises.writeFile(hookSettingsPath, JSON.stringify(hookSettings), 'utf8');
        }

        const { shellPath, shellArgs } = await this._buildCommand({ resume, agent, permissionMode, model, effortLevel, mcpConfigPath, hookSettingsPath });

        const configDir = await this.configService.getConfigurationDirectory();
        const customVars = await this.configService.getEnvironmentVariables();
        const env: Record<string, string> = {
            ...process.env as Record<string, string>,
            CLAUDE_CODE_ENTRYPOINT: 'claude-vscode',
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            ...customVars,
        };
        if (configDir) env.CLAUDE_CONFIG_DIR = configDir;

        // node-pty is copied into resources/node-pty/ at build time so it is
        // always available at a known path regardless of node_modules layout.
        const ptyRoot = path.join(this.context.extensionPath, 'resources', 'node-pty');

        // Ensure spawn-helper is executable (needed by node-pty on POSIX).
        for (const helperPath of [
            path.join(ptyRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
            path.join(ptyRoot, 'build', 'Release', 'spawn-helper'),
        ]) {
            try { fs.chmodSync(helperPath, 0o755); } catch { /* not present */ }
        }

        const nodeBin = await this._findSystemNode();
        const bridgePath = this.context.asAbsolutePath('resources/pty-bridge.cjs');
        const ptyModulePath = ptyRoot;

        this.logService.info(`[ClaudeTerminalService] spawn channelId=${channelId} ${shellPath} ${shellArgs.join(' ')}`);

        const bridge = child_process.spawn(nodeBin, [bridgePath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, NODE_PTY_PATH: ptyModulePath },
        });

        bridge.stderr?.setEncoding('utf8');
        bridge.stderr?.on('data', (chunk: string) => {
            this.logService.warn(`[ClaudeTerminalService] bridge stderr channelId=${channelId}: ${chunk.trim()}`);
        });

        let lineBuffer = '';
        let exitFired = false;

        const fireExit = (code: number) => {
            if (exitFired) return;
            exitFired = true;
            this._bridges.delete(channelId);
            this._exitHandler?.(channelId, code);
        };

        bridge.stdout?.setEncoding('utf8');
        bridge.stdout?.on('data', (chunk: string) => {
            lineBuffer += chunk;
            let nl: number;
            while ((nl = lineBuffer.indexOf('\n')) !== -1) {
                const line = lineBuffer.slice(0, nl).trim();
                lineBuffer = lineBuffer.slice(nl + 1);
                if (!line) continue;
                try {
                    const msg = JSON.parse(line) as { type: string; data?: string; code?: number; message?: string };
                    if (msg.type === 'data' && msg.data !== undefined) {
                        this._dataHandler?.(channelId, msg.data);
                    } else if (msg.type === 'exit') {
                        fireExit(msg.code ?? 0);
                    } else if (msg.type === 'error') {
                        this.logService.error(`[ClaudeTerminalService] bridge error channelId=${channelId}: ${msg.message}`);
                    }
                } catch { /* ignore malformed lines */ }
            }
        });

        bridge.on('exit', (code) => {
            fireExit(code ?? 0);
        });

        // Send the spawn command to the bridge.
        const spawnMsg = JSON.stringify({
            type: 'spawn',
            file: shellPath,
            args: shellArgs,
            options: { name: 'xterm-256color', cols, rows, cwd, env },
        });
        bridge.stdin?.write(spawnMsg + '\n');

        this._bridges.set(channelId, bridge);
    }

    write(channelId: string, data: string): void {
        const bridge = this._bridges.get(channelId);
        if (bridge?.stdin) {
            bridge.stdin.write(JSON.stringify({ type: 'write', data }) + '\n');
        }
    }

    resize(channelId: string, cols: number, rows: number): void {
        const bridge = this._bridges.get(channelId);
        if (bridge?.stdin) {
            try {
                bridge.stdin.write(JSON.stringify({ type: 'resize', cols, rows }) + '\n');
            } catch { /* ignore if stdin closed */ }
        }
    }

    kill(channelId: string): void {
        const bridge = this._bridges.get(channelId);
        if (bridge) {
            try {
                bridge.stdin?.write(JSON.stringify({ type: 'kill' }) + '\n');
                bridge.stdin?.end();
            } catch { /* ignore */ }
            this._bridges.delete(channelId);
        }
    }

    onData(handler: (channelId: string, data: string) => void): void {
        this._dataHandler = handler;
    }

    onExit(handler: (channelId: string, exitCode: number) => void): void {
        this._exitHandler = handler;
    }

    /** Find the system `node` binary (not Electron's bundled node). */
    private async _findSystemNode(): Promise<string> {
        // Try PATH-based lookup first.
        for (const cmd of process.platform === 'win32' ? ['where.exe', 'node'] : ['which', 'node']) {
            try {
                const result = child_process.execFileSync(
                    process.platform === 'win32' ? 'where.exe' : 'which',
                    ['node'],
                    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000 }
                ).trim().split('\n')[0].trim();
                if (result && result !== process.execPath) return result;
                if (result) return result;
            } catch { /* not found via which */ }
            break;
        }
        // Fallback: well-known locations.
        for (const p of [
            '/opt/homebrew/bin/node',
            '/usr/local/bin/node',
            '/usr/bin/node',
        ]) {
            if (fs.existsSync(p)) return p;
        }
        // Last resort: use Electron's own node (may still fail for ABI mismatch,
        // but the prebuilt fallback path in node-pty may save us).
        return process.execPath;
    }

    private async _buildCommand(opts: {
        resume?: string | null;
        agent?: string | null;
        permissionMode?: string;
        model?: string | null;
        effortLevel?: string | null;
        mcpConfigPath?: string;
        hookSettingsPath?: string;
    }): Promise<{ shellPath: string; shellArgs: string[] }> {
        const args: string[] = [];

        if (opts.resume) {
            args.push('--resume', opts.resume);
        } else if (opts.agent) {
            args.push('--agent', opts.agent);
        }

        const permissionMode = opts.permissionMode
            ?? vscode.workspace.getConfiguration('relay').get<string>('defaultPermissionMode', 'default');
        args.push('--permission-mode', permissionMode);

        const model = opts.model ?? await this.configService.getSetting<string>('model');
        if (model && model !== 'default') {
            args.push('--model', model);
        }

        const effortLevel = opts.effortLevel ?? await this.configService.getSetting<string>('effortLevel');
        if (effortLevel && effortLevel.toLowerCase() !== 'adaptive') {
            args.push('--effort', effortLevel);
        }

        if (opts.mcpConfigPath) {
            args.push('--allowedTools', 'mcp__relay');
            args.push('--permission-prompt-tool', 'mcp__relay__permission_prompt');
            args.push('--mcp-config', opts.mcpConfigPath);
        }

        if (opts.hookSettingsPath) {
            args.push('--settings', opts.hookSettingsPath);
        }

        const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
        const nativePath = this.context.asAbsolutePath(
            `resources/native-binaries/${process.platform}-${process.arch}/${binaryName}`
        );

        // On POSIX, wrap in the user's shell so the OS handles exec of the large binary.
        if (process.platform !== 'win32' && await this.fileSystemService.pathExists(nativePath)) {
            const shell = process.env.SHELL || '/bin/zsh';
            const escape = (s: string) => `'${s.replace(/'/g, "'\"'\"'")}'`;
            const cmd = `exec ${[nativePath, ...args].map(escape).join(' ')}`;
            return { shellPath: shell, shellArgs: ['-c', cmd] };
        }

        if (process.platform === 'win32' && await this.fileSystemService.pathExists(nativePath)) {
            return { shellPath: nativePath, shellArgs: args };
        }

        const jsPath = this.context.asAbsolutePath('resources/claude-code/cli.js');
        return { shellPath: process.execPath, shellArgs: [jsPath, ...args] };
    }
}
