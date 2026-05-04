/**
 * VSCode Extension Entry Point
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { InstantiationServiceBuilder } from './di/instantiationServiceBuilder';
import { registerServices, ILogService, IClaudeAgentService, IWebViewService, IConfigurationService } from './services/serviceRegistry';
import { VSCodeTransport } from './services/claude/transport/VSCodeTransport';

let _webViewService: IWebViewService | undefined;

// ── Agent discovery ────────────────────────────────────────────────────────

interface AgentInfo {
	name: string;
	description?: string;
	model?: string;
}

function listAllAgents(configDir?: string): AgentInfo[] {
	const claudeDir = configDir ?? path.join(os.homedir(), '.claude');
	const agents: AgentInfo[] = [];
	const seen = new Set<string>();

	// Walk ~/.claude/agents/ directly
	walkAgentsDir(path.join(claudeDir, 'agents'), agents, seen);

	// Walk plugin cache: find plugin.json files, read their agents arrays
	const cacheDir = path.join(claudeDir, 'plugins', 'cache');
	for (const pluginJsonPath of findPluginJsonFiles(cacheDir)) {
		let manifest: { agents?: string[] };
		try { manifest = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8')); } catch { continue; }
		if (!Array.isArray(manifest.agents)) continue;
		const pluginRoot = path.dirname(path.dirname(pluginJsonPath));
		for (const agentPath of manifest.agents) {
			const full = path.resolve(pluginRoot, agentPath);
			const agent = parseAgentFileMini(full);
			if (agent && !seen.has(agent.name)) {
				seen.add(agent.name);
				agents.push(agent);
			}
		}
	}

	return agents;
}

function findPluginJsonFiles(dir: string): string[] {
	const results: string[] = [];
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findPluginJsonFiles(full));
		} else if (entry.isFile() && entry.name === 'plugin.json') {
			results.push(full);
		}
	}
	return results;
}

function walkAgentsDir(dir: string, results: AgentInfo[], seen: Set<string>): void {
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkAgentsDir(full, results, seen);
		} else if (entry.isFile() && entry.name.endsWith('.md')) {
			const agent = parseAgentFileMini(full);
			if (agent && !seen.has(agent.name)) {
				seen.add(agent.name);
				results.push(agent);
			}
		}
	}
}

function parseAgentFileMini(filePath: string): AgentInfo | null {
	let content: string;
	try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return null;
	const fm = match[1];
	const get = (key: string) => {
		const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
		return m ? m[1].trim() : undefined;
	};
	const name = get('name');
	if (!name) return null;
	return { name, description: get('description'), model: get('model') };
}

/**
 * Extension Activation
 */
export function activate(context: vscode.ExtensionContext) {
	// 1. Create service builder
	const builder = new InstantiationServiceBuilder();

	// 2. Register all services
	registerServices(builder, context);

	// 3. Seal the builder and create DI container
	const instantiationService = builder.seal();

	// 4. Log activation
	instantiationService.invokeFunction(accessor => {
		const logService = accessor.get(ILogService);
		logService.info('');
		logService.info('╔════════════════════════════════════════╗');
		logService.info('║    Claude Chat Extension Activated    ║');
		logService.info('╚════════════════════════════════════════╝');
		logService.info('');
	});

	// 5. Connect services
	instantiationService.invokeFunction(accessor => {
		const logService = accessor.get(ILogService);
		const webViewService = accessor.get(IWebViewService);
		_webViewService = webViewService;
		const claudeAgentService = accessor.get(IClaudeAgentService);
		const configService = accessor.get(IConfigurationService);
		const subscriptions = context.subscriptions;

		// Initialize relayFocused context (will be updated by webview focus events)
		vscode.commands.executeCommand('setContext', 'relayFocused', false);

		// Track the last focused webviewId for targeted commands (e.g. clearSession)
		let lastFocusedWebviewId: string | undefined;

		// Register WebView View Provider (sidebar session list)
		const webviewProvider = vscode.window.registerWebviewViewProvider(
			'relay.sessionList',
			webViewService,
			{
				webviewOptions: {
					retainContextWhenHidden: true
				}
			}
		);

		// Connect WebView messages to Claude Agent Service
		webViewService.setMessageHandler((message) => {
			// Handle focus_changed messages directly (for keyboard shortcuts)
			if (message.type === 'focus_changed') {
				const focused = (message as any).focused;
				vscode.commands.executeCommand('setContext', 'relayFocused', focused);
				if (focused && message.webviewId) {
					lastFocusedWebviewId = message.webviewId;
				}
				logService.info(`[Focus] Relay focused: ${focused}`);
				return;
			}

			// Handle request messages that need extension-level processing
			if (message.type === 'request') {
				const req = (message as any).request;

				// Open (or focus) a chat panel for a specific session
				if (req.type === 'open_session_panel') {
					const sessionId: string | null = req.sessionId || null;
					const title: string = req.title || (sessionId ? 'Chat' : 'New Chat');
					webViewService.openChatPanel(sessionId, title);
					// Send response back to the requesting webview
					webViewService.postMessage({
						type: 'response',
						requestId: message.requestId,
						webviewId: message.webviewId,
						response: { type: 'open_session_panel_response' }
					});
					return;
				}

				// Open a new chat panel (from sidebar or panel /new command)
				if (req.type === 'new_conversation_tab') {
					webViewService.openChatPanel(null, 'New Chat');
					webViewService.postMessage({
						type: 'response',
						requestId: message.requestId,
						webviewId: message.webviewId,
						response: { type: 'new_conversation_tab_response' }
					});
					return;
				}

				// Update the chat panel title when a session summary changes
				if (req.type === 'rename_tab') {
					const title: string = req.title || 'Claude Chat';
					const webviewId: string | undefined = message.webviewId;
					if (webviewId && webviewId.startsWith('panel:chat:')) {
						webViewService.updateChatPanelTitle(webviewId, title);
					}
					webViewService.postMessage({
						type: 'response',
						requestId: message.requestId,
						webviewId: message.webviewId,
						response: { type: 'rename_tab_response' }
					});
					return;
				}

				// Update the session ID associated with a chat panel (e.g. after /clear
				// replaces the session inside an existing panel) so session restore picks
				// up the latest active session in that tab.
				if (req.type === 'update_panel_session') {
					const webviewId: string | undefined = message.webviewId;
					if (webviewId && webviewId.startsWith('panel:chat:')) {
						if (!req.sessionId) {
							logService.warn(`[extension] update_panel_session called with null sessionId for webviewId=${webviewId} — restore failure likely caused a new session to replace an existing one`);
						}
						webViewService.updateChatPanelSession(webviewId, req.sessionId ?? null);
					}
					webViewService.postMessage({
						type: 'response',
						requestId: message.requestId,
						webviewId: message.webviewId,
						response: { type: 'update_panel_session_response' }
					});
					return;
				}

				// Update the chat panel badge when permission requests change
				if (req.type === 'set_panel_badge') {
					const count: number = req.count ?? 0;
					const iconState: string | undefined = req.iconState;
					const webviewId: string | undefined = message.webviewId;
					if (webviewId && webviewId.startsWith('panel:chat:')) {
						webViewService.updateChatPanelBadge(webviewId, count, iconState);
					}
					webViewService.postMessage({
						type: 'response',
						requestId: message.requestId,
						webviewId: message.webviewId,
						response: { type: 'set_panel_badge_response' }
					});
					return;
				}
			}

			// Forward all other messages to Claude Agent Service
			claudeAgentService.fromClient(message);
		});

		// Create VSCode Transport
		const transport = instantiationService.createInstance(VSCodeTransport);

		// Set transport on Claude Agent Service
		claudeAgentService.setTransport(transport);

		// Start message loop
		claudeAgentService.start();

		// Restore chat panels that were open when the workspace was last closed
		webViewService.restoreOpenSessions();

		// Listen for VSCode configuration changes and notify webview
		const configChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('relay.defaultPermissionMode') ||
			    e.affectsConfiguration('relay.defaultThinkingLevel') ||
			    e.affectsConfiguration('relay.expandToolOutput') ||
			    e.affectsConfiguration('relay.showThinking') ||
			    			    e.affectsConfiguration('relay.autoInterruptOnRoaming')) {
				const config = vscode.workspace.getConfiguration('relay');
				const permissionMode = config.get<string>('defaultPermissionMode') ?? 'default';
				const thinkingLevel = config.get<string>('defaultThinkingLevel') ?? 'on';
				const expandToolOutput = config.get<boolean>('expandToolOutput') ?? true;
				const showThinking = config.get<boolean>('showThinking') ?? false;
				const autoInterruptOnRoaming = config.get<boolean>('autoInterruptOnRoaming') ?? false;

				// Send update_state message to webview
				webViewService.postMessage({
					type: 'request',
					requestId: `config-update-${Date.now()}`,
					request: {
						type: 'update_state',
						state: {
							permissionMode,
							thinkingLevel,
							expandToolOutput,
							showThinking,
							autoInterruptOnRoaming
						}
					}
				});

				logService.info(`VSCode configuration updated: permissionMode=${permissionMode}, thinkingLevel=${thinkingLevel}, expandToolOutput=${expandToolOutput}, showThinking=${showThinking}, autoInterruptOnRoaming=${autoInterruptOnRoaming}`);
			}
		});

		context.subscriptions.push(configChangeListener);

		// ── Shared agent picker logic ──────────────────────────────────────────
		async function pickAgentAndOpen(): Promise<void> {
			const agents = listAllAgents();
			if (agents.length === 0) {
				webViewService.openChatPanel(null, 'New Chat');
				return;
			}

			const defaultAgentName = vscode.workspace.getConfiguration('relay').get<string>('defaultAgent', '');

			const items: vscode.QuickPickItem[] = [];

			const defaultAgent = defaultAgentName ? agents.find(a => a.name === defaultAgentName) : undefined;
			if (defaultAgent) {
				items.push({
					label: defaultAgent.name,
					description: defaultAgent.description,
					detail: defaultAgent.model ? `Model: ${defaultAgent.model}` : undefined,
				});
				items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
			}

			items.push({ label: 'Default (no agent)', description: 'Start without an agent definition' });

			for (const agent of agents) {
				if (agent.name === defaultAgentName) continue;
				items.push({
					label: agent.name,
					description: agent.description,
					detail: agent.model ? `Model: ${agent.model}` : undefined,
				});
			}

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select an agent for this session',
				matchOnDescription: true,
			});

			if (selected === undefined) return; // cancelled

			const agentName = selected.label === 'Default (no agent)' ? undefined : selected.label;
			webViewService.openChatPanel(null, 'New Chat', agentName);
		}

		// Register disposables
		context.subscriptions.push(webviewProvider);
		context.subscriptions.push(
			vscode.commands.registerCommand('relay.newSession', () => {
				void pickAgentAndOpen();
			})
		);
		context.subscriptions.push(
			vscode.commands.registerCommand('relay.newSessionPanel', () => {
				void pickAgentAndOpen();
			})
		);
		context.subscriptions.push(
			vscode.commands.registerCommand('relay.newSessionDefault', async () => {
				const defaultAgentName = vscode.workspace.getConfiguration('relay').get<string>('defaultAgent', '');
				webViewService.openChatPanel(null, 'New Chat', defaultAgentName || undefined);
			})
		);

		context.subscriptions.push(
			vscode.commands.registerCommand('relay.toggleSearch', () => {
				webViewService.postMessage({
					type: 'toggle_search',
					webviewId: 'sidebar:sessions:'
				});
			})
		);

		context.subscriptions.push(
			vscode.commands.registerCommand('relay.clearSession', () => {
				// Send new_session to the last focused panel/webview
				const targetId = lastFocusedWebviewId;
				if (targetId) {
					webViewService.postMessage({
						type: 'request',
						requestId: `clear-session-${Date.now()}`,
						webviewId: targetId,
						request: { type: 'new_session' }
					});
				}
			})
		);

		context.subscriptions.push(
			vscode.commands.registerCommand('relay.compact', () => {
				const targetId = lastFocusedWebviewId;
				if (targetId) {
					webViewService.postMessage({
						type: 'request',
						requestId: `compact-session-${Date.now()}`,
						webviewId: targetId,
						request: { type: 'compact_session' }
					});
				}
			})
		);

		context.subscriptions.push(
			vscode.commands.registerCommand('relay.closeSession', () => {
				const targetId = lastFocusedWebviewId;
				if (!targetId) return;
				if (targetId.startsWith('panel:')) {
					// In panel mode, dispose the VSCode panel directly
					webViewService.closeChatPanel(targetId);
				} else {
					// In sidebar/editor tab mode, ask the webview to close its internal tab
					webViewService.postMessage({
						type: 'request',
						requestId: `close-tab-${Date.now()}`,
						webviewId: targetId,
						request: { type: 'close_tab' }
					});
				}
			})
		);

		logService.info('✓ Claude Agent Service connected to Transport');
		logService.info('✓ WebView Service registered as Session List sidebar provider');
	});

	// 6. Register commands
	const showChatCommand = vscode.commands.registerCommand('relay.showChat', () => {
		vscode.commands.executeCommand('relay.sessionList.focus');
	});

	context.subscriptions.push(showChatCommand);

	// 7. Log completion
	instantiationService.invokeFunction(accessor => {
		const logService = accessor.get(ILogService);
		logService.info('✓ Claude Session List view registered');
		logService.info('');
	});

	// Return extension API (if needed to expose to other extensions)
	return {
		getInstantiationService: () => instantiationService
	};
}

/**
 * Extension Deactivation
 */
export function deactivate() {
	_webViewService?.beginDeactivation();
}
