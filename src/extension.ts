/**
 * VSCode Extension Entry Point
 */

import * as vscode from 'vscode';
import { InstantiationServiceBuilder } from './di/instantiationServiceBuilder';
import { registerServices, ILogService, IClaudeAgentService, IWebViewService } from './services/serviceRegistry';
import { VSCodeTransport } from './services/claude/transport/VSCodeTransport';

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
		const claudeAgentService = accessor.get(IClaudeAgentService);
		const subscriptions = context.subscriptions;

		// Initialize claudixFocused context (will be updated by webview focus events)
		vscode.commands.executeCommand('setContext', 'claudixFocused', false);

		// Track the last focused webviewId for targeted commands (e.g. clearSession)
		let lastFocusedWebviewId: string | undefined;

		// Register WebView View Provider (sidebar session list)
		const webviewProvider = vscode.window.registerWebviewViewProvider(
			'claudix.sessionList',
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
				vscode.commands.executeCommand('setContext', 'claudixFocused', focused);
				if (focused && message.webviewId) {
					lastFocusedWebviewId = message.webviewId;
				}
				logService.info(`[Focus] Claudix focused: ${focused}`);
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

				// Update the chat panel badge when permission requests change
				if (req.type === 'set_panel_badge') {
					const count: number = req.count ?? 0;
					const webviewId: string | undefined = message.webviewId;
					if (webviewId && webviewId.startsWith('panel:chat:')) {
						webViewService.updateChatPanelBadge(webviewId, count);
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
			if (e.affectsConfiguration('claudix.defaultPermissionMode') ||
			    e.affectsConfiguration('claudix.defaultThinkingLevel') ||
			    e.affectsConfiguration('claudix.expandToolOutput') ||
			    e.affectsConfiguration('claudix.showThinking')) {
				const config = vscode.workspace.getConfiguration('claudix');
				const permissionMode = config.get<string>('defaultPermissionMode') ?? 'default';
				const thinkingLevel = config.get<string>('defaultThinkingLevel') ?? 'on';
				const expandToolOutput = config.get<boolean>('expandToolOutput') ?? true;
				const showThinking = config.get<boolean>('showThinking') ?? false;

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
							showThinking
						}
					}
				});

				logService.info(`VSCode configuration updated: permissionMode=${permissionMode}, thinkingLevel=${thinkingLevel}, expandToolOutput=${expandToolOutput}, showThinking=${showThinking}`);
			}
		});

		context.subscriptions.push(configChangeListener);

		// Register disposables
		context.subscriptions.push(webviewProvider);
		context.subscriptions.push(
			vscode.commands.registerCommand('claudix.newSession', () => {
				webViewService.openChatPanel(null, 'New Chat');
			})
		);

		context.subscriptions.push(
			vscode.commands.registerCommand('claudix.clearSession', () => {
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
			vscode.commands.registerCommand('claudix.closeSession', () => {
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

		context.subscriptions.push(
			vscode.commands.registerCommand('claudix.openSettings', async () => {
				await instantiationService.invokeFunction(accessorInner => {
					const webViewServiceInner = accessorInner.get(IWebViewService);
					const logServiceInner = accessorInner.get(ILogService);
					try {
						// Settings 页为单实例，不传 instanceId，使用 page 作为 key
						webViewServiceInner.openEditorPage('settings', 'Claudix Settings');
					} catch (error) {
						logServiceInner.error('[Command] 打开 Settings 页面失败', error);
					}
				});
			})
		);

		logService.info('✓ Claude Agent Service connected to Transport');
		logService.info('✓ WebView Service registered as Session List sidebar provider');
		logService.info('✓ Settings command registered');
	});

	// 6. Register commands
	const showChatCommand = vscode.commands.registerCommand('claudix.showChat', () => {
		vscode.commands.executeCommand('claudix.sessionList.focus');
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
	// Clean up resources
}
