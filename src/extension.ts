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

		// Register WebView View Provider
		const webviewProvider = vscode.window.registerWebviewViewProvider(
			'claudix.chatView',
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
				logService.info(`[Focus] Claudix focused: ${focused}`);
				return;
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

		// Listen for VSCode configuration changes and notify webview
		const configChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('claudix.disableFunSpinner') ||
			    e.affectsConfiguration('claudix.continueLastSession') ||
			    e.affectsConfiguration('claudix.defaultPermissionMode') ||
			    e.affectsConfiguration('claudix.defaultThinkingLevel') ||
			    e.affectsConfiguration('claudix.expandToolOutput') ||
			    e.affectsConfiguration('claudix.showThinking')) {
				const config = vscode.workspace.getConfiguration('claudix');
				const disableFunSpinner = config.get<boolean>('disableFunSpinner') ?? false;
				const funSpinner = !disableFunSpinner;
				const continueLastSession = config.get<boolean>('continueLastSession') ?? false;
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
							funSpinner,
							continueLastSession,
							permissionMode,
							thinkingLevel,
							expandToolOutput,
							showThinking
						}
					}
				});

				logService.info(`VSCode configuration updated: funSpinner=${funSpinner}, continueLastSession=${continueLastSession}, permissionMode=${permissionMode}, thinkingLevel=${thinkingLevel}, expandToolOutput=${expandToolOutput}, showThinking=${showThinking}`);
			}
		});

		context.subscriptions.push(configChangeListener);

		// Register disposables
		context.subscriptions.push(webviewProvider);
		context.subscriptions.push(
			vscode.commands.registerCommand('claudix.newSession', () => {
				webViewService.postMessage({
					type: 'request',
					requestId: `new-tab-${Date.now()}`,
					request: { type: 'new_tab' }
				});
			})
		);

		context.subscriptions.push(
			vscode.commands.registerCommand('claudix.clearSession', () => {
				webViewService.postMessage({
					type: 'request',
					requestId: `clear-session-${Date.now()}`,
					request: { type: 'new_session' }
				});
			})
		);

		context.subscriptions.push(
			vscode.commands.registerCommand('claudix.closeSession', () => {
				webViewService.postMessage({
					type: 'request',
					requestId: `close-tab-${Date.now()}`,
					request: { type: 'close_tab' }
				});
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
		logService.info('✓ WebView Service registered as View Provider');
		logService.info('✓ Settings command registered');
	});

	// 6. Register commands
	const showChatCommand = vscode.commands.registerCommand('claudix.showChat', () => {
		vscode.commands.executeCommand('claudix.chatView.focus');
	});

	context.subscriptions.push(showChatCommand);

	// 7. Log completion
	instantiationService.invokeFunction(accessor => {
		const logService = accessor.get(ILogService);
		logService.info('✓ Claude Chat view registered');
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
