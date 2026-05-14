/**
 * Terminal Service
 */

import * as vscode from 'vscode';
import * as os from 'os';
import { createDecorator } from '../di/instantiation';
import { IConfigurationService } from './configurationService';
import { IFileSystemService } from './fileSystemService';

export const ITerminalService = createDecorator<ITerminalService>('terminalService');

export interface ClaudeTerminalSessionOpts {
	sessionId?: string;      // Resume an existing session via --resume
	sessionTitle?: string;   // Terminal name suffix
	agent?: string;          // Start with a specific agent via --agent (new sessions only)
	cwd: string;             // Terminal working directory
}

export interface ITerminalService {
	readonly _serviceBrand: undefined;

	createTerminal(name?: string, shellPath?: string, shellArgs?: readonly string[] | string): vscode.Terminal;
	createTerminal(options: vscode.TerminalOptions): vscode.Terminal;
	createTerminal(options: vscode.ExtensionTerminalOptions): vscode.Terminal;

	getActiveTerminal(): vscode.Terminal | undefined;
	sendText(text: string, addNewLine?: boolean): void;

	openClaudeSession(opts: ClaudeTerminalSessionOpts): void;
}

export class TerminalService implements ITerminalService {
	readonly _serviceBrand: undefined;

	private readonly _terminals = new Map<string, vscode.Terminal>();

	constructor(
		private readonly context: vscode.ExtensionContext,
		@IConfigurationService private readonly configService: IConfigurationService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService
	) {}

	createTerminal(name?: string, shellPath?: string, shellArgs?: readonly string[] | string): vscode.Terminal;
	createTerminal(options: vscode.TerminalOptions): vscode.Terminal;
	createTerminal(options: vscode.ExtensionTerminalOptions): vscode.Terminal;
	createTerminal(name?: any, shellPath?: any, shellArgs?: any): vscode.Terminal {
		return vscode.window.createTerminal(name, shellPath, shellArgs);
	}

	getActiveTerminal(): vscode.Terminal | undefined {
		return vscode.window.activeTerminal;
	}

	sendText(text: string, addNewLine: boolean = true): void {
		const terminal = this.getActiveTerminal();
		if (terminal) {
			terminal.sendText(text, addNewLine);
		}
	}

	openClaudeSession(opts: ClaudeTerminalSessionOpts): void {
		// Reuse an existing terminal for this session if it's still alive
		if (opts.sessionId) {
			const existing = this._terminals.get(opts.sessionId);
			if (existing && existing.exitStatus === undefined) {
				existing.show();
				return;
			}
		}

		void this._launchClaudeTerminal(opts);
	}

	private async _launchClaudeTerminal(opts: ClaudeTerminalSessionOpts): Promise<void> {
		const { shellPath, shellArgs } = await this._buildCommand(opts);

		const configDir = await this.configService.getConfigurationDirectory();
		const customVars = await this.configService.getEnvironmentVariables();

		const env: Record<string, string> = {
			CLAUDE_CODE_ENTRYPOINT: 'claude-vscode',
			...customVars,
		};
		if (configDir) {
			env.CLAUDE_CONFIG_DIR = configDir;
		}

		const label = opts.sessionId
			? `Claude: ${opts.sessionTitle ?? opts.sessionId.slice(0, 8)}`
			: `Claude: ${opts.agent ?? 'new session'}`;

		const terminal = vscode.window.createTerminal({
			name: label,
			cwd: opts.cwd,
			env,
			shellPath,
			shellArgs,
			location: { viewColumn: vscode.ViewColumn.Active },
		});

		if (opts.sessionId) {
			this._terminals.set(opts.sessionId, terminal);
		}

		terminal.show();
	}

	private async _buildCommand(opts: ClaudeTerminalSessionOpts): Promise<{ shellPath: string; shellArgs: string[] }> {
		const args: string[] = [];
		if (opts.sessionId) {
			args.push('--resume', opts.sessionId);
		} else if (opts.agent) {
			args.push('--agent', opts.agent);
		}

		const permissionMode = vscode.workspace.getConfiguration('relay').get<string>('defaultPermissionMode', 'default');
		args.push('--permission-mode', permissionMode);

		const model = await this.configService.getSetting<string>('model');
		if (model && model !== 'default') {
			args.push('--model', model);
		}

		const effortLevel = await this.configService.getSetting<string>('effortLevel');
		if (effortLevel && effortLevel.toLowerCase() !== 'adaptive') {
			args.push('--effort', effortLevel);
		}

		const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
		const nativePath = this.context.asAbsolutePath(
			`resources/native-binaries/${process.platform}-${process.arch}/${binaryName}`
		);

		if (await this.fileSystemService.pathExists(nativePath)) {
			return { shellPath: nativePath, shellArgs: args };
		}

		const jsPath = this.context.asAbsolutePath('resources/claude-code/cli.js');
		return { shellPath: process.execPath, shellArgs: [jsPath, ...args] };
	}
}
