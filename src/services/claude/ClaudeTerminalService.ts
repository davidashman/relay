/**
 * ClaudeTerminalService — manages node-pty instances for integrated terminal sessions.
 * Each PTY maps to a webview channel; I/O is forwarded via callbacks set by ClaudeAgentService.
 */

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

    private readonly _ptys = new Map<string, import('node-pty').IPty>();
    private _dataHandler?: (channelId: string, data: string) => void;
    private _exitHandler?: (channelId: string, exitCode: number) => void;

    constructor(
        private readonly context: vscode.ExtensionContext,
        @ILogService private readonly logService: ILogService,
        @IConfigurationService private readonly configService: IConfigurationService,
        @IFileSystemService private readonly fileSystemService: IFileSystemService,
    ) {}

    async spawn(opts: PtySpawnOptions): Promise<void> {
        const { channelId, resume, agent, permissionMode, model, effortLevel, cwd, cols, rows } = opts;

        const { shellPath, shellArgs } = await this._buildCommand({ resume, agent, permissionMode, model, effortLevel });

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

        this.logService.info(`[ClaudeTerminalService] spawn channelId=${channelId} ${shellPath} ${shellArgs.join(' ')}`);

        // node-pty is marked external in esbuild — require at runtime
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodePty = require('node-pty') as typeof import('node-pty');

        // spawn-helper ships without execute permission in the npm tarball; fix it
        try {
            const spawnHelper = require.resolve('node-pty').replace(/[/\\]lib[/\\].*$/, '') + '/prebuilds/' + process.platform + '-' + process.arch + '/spawn-helper';
            fs.chmodSync(spawnHelper, 0o755);
        } catch { /* not present on this platform */ }

        const pty = nodePty.spawn(shellPath, shellArgs, {
            name: 'xterm-256color',
            cols,
            rows,
            cwd,
            env,
        });

        pty.onData((data: string) => {
            this._dataHandler?.(channelId, data);
        });

        pty.onExit(({ exitCode }: { exitCode: number }) => {
            this.logService.info(`[ClaudeTerminalService] PTY exited channelId=${channelId} code=${exitCode}`);
            this._ptys.delete(channelId);
            this._exitHandler?.(channelId, exitCode);
        });

        this._ptys.set(channelId, pty);
    }

    write(channelId: string, data: string): void {
        this._ptys.get(channelId)?.write(data);
    }

    resize(channelId: string, cols: number, rows: number): void {
        try {
            this._ptys.get(channelId)?.resize(cols, rows);
        } catch {
            // ignore resize errors on a closed pty
        }
    }

    kill(channelId: string): void {
        try {
            this._ptys.get(channelId)?.kill();
        } catch {
            // ignore
        }
        this._ptys.delete(channelId);
    }

    onData(handler: (channelId: string, data: string) => void): void {
        this._dataHandler = handler;
    }

    onExit(handler: (channelId: string, exitCode: number) => void): void {
        this._exitHandler = handler;
    }

    private async _buildCommand(opts: {
        resume?: string | null;
        agent?: string | null;
        permissionMode?: string;
        model?: string | null;
        effortLevel?: string | null;
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

        const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
        const nativePath = this.context.asAbsolutePath(
            `resources/native-binaries/${process.platform}-${process.arch}/${binaryName}`
        );

        // On POSIX, node-pty's posix_spawnp can fail when given a large binary
        // directly. Wrap in the user's shell instead so the OS handles the exec.
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
