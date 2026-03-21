/**
 * VSCode Extension Entry Point
 */

import * as vscode from 'vscode';
import { InstantiationServiceBuilder } from './di/instantiationServiceBuilder';
import { registerServices, ILogService, IClaudeAgentService, IWebViewService, IConfigurationService } from './services/serviceRegistry';
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
			claudeAgentService.fromClient(message);
		});

		// Create VSCode Transport
		const transport = instantiationService.createInstance(VSCodeTransport);

		// Set transport on Claude Agent Service
		claudeAgentService.setTransport(transport);

		// Start message loop
		claudeAgentService.start();

		// Register disposables
		context.subscriptions.push(webviewProvider);
		context.subscriptions.push(
			vscode.commands.registerCommand('claudix.openSettings', async () => {
				await instantiationService.invokeFunction(accessorInner => {
					const webViewServiceInner = accessorInner.get(IWebViewService);
					const configServiceInner = accessorInner.get(IConfigurationService);
					const logServiceInner = accessorInner.get(ILogService);
					try {
						const settings = {
							continueLastSession: configServiceInner.getValue<boolean>('claudix.continueLastSession') ?? false,
						};
						webViewServiceInner.openEditorPage('settings', 'Claudix Settings', undefined, settings);
					} catch (error) {
						logServiceInner.error('[Command] Failed to open Settings page', error);
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
