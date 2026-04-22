/**
 * WebView  / WebView Service
 *
 * 1.  vscode.WebviewViewProvider
 * 2.  WebView
 * 3.  WebView HTML
 * 4.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { createDecorator } from '../di/instantiation';
import { ILogService } from './logService';

export const IWebViewService = createDecorator<IWebViewService>('webViewService');

export type WebviewHost = 'sidebar' | 'editor' | 'panel';

export interface WebviewBootstrapConfig {
	host: WebviewHost;
	page?: string;
	id?: string;
	/** Initial panel title for chat panels, so the WebView can set it before sessions load */
	title?: string;
}

export interface IWebViewService extends vscode.WebviewViewProvider {
	readonly _serviceBrand: undefined;

	/**
	 *  WebView  webviewUri
	 */
	getWebView(): vscode.Webview | undefined;

	/**
	 *  WebView
	 */
	postMessage(message: any): void;

	/**
	 *  WebView
	 */
	setMessageHandler(handler: (message: any) => void): void;

	/**
	 *
	 * @param page  'settings''diff'
	 * @param title VSCode
	 * @param instanceId  ID page
	 */
	openEditorPage(page: string, title: string, instanceId?: string): void;

	/**
	 *
	 * @param sessionId  IDnull
	 * @param title
	 */
	openChatPanel(sessionId: string | null, title: string): void;

	/**
	 *  webviewId
	 */
	updateChatPanelTitle(webviewId: string, title: string): void;

	/**
	 *  ID
	 *  /clear
	 */
	updateChatPanelSession(webviewId: string, sessionId: string | null): void;

	/**
	 *  webviewId
	 */
	closeChatPanel(webviewId: string): void;

	/**
	 * Update the tab icon state for a chat panel.
	 * iconState: 'pending' = blue (permission waiting), 'done' = green (turn complete), 'default' = orange (idle/working)
	 */
	updateChatPanelBadge(webviewId: string, count: number, iconState?: string): void;

	/**
	 * Re-open chat panels that were open when the workspace was last closed.
	 * Should be called once during extension activation.
	 */
	restoreOpenSessions(): void;
}

/**
 * WebView
 */
export class WebViewService implements IWebViewService {
	readonly _serviceBrand: undefined;

	private static readonly OPEN_SESSIONS_KEY = 'relay.openSessions';

	private readonly webviews = new Set<vscode.Webview>();
	private readonly webviewConfigs = new Map<vscode.Webview, WebviewBootstrapConfig>();
	private readonly webviewIdMap = new Map<string, vscode.Webview>();
	private messageHandler?: (message: any) => void;
	private readonly editorPanels = new Map<string, vscode.WebviewPanel>();
	/** Map from panelKey (sessionId or generated key) to chat panel */
	private readonly chatPanels = new Map<string, vscode.WebviewPanel>();
	/** Map from webviewId (e.g. 'panel:chat:key') to panel key, for title updates */
	private readonly chatPanelWebviewIds = new Map<string, string>();
	/** Tracks session IDs of currently-open chat panels for persistence (sessionId → title) */
	private readonly openSessionIds = new Map<string, string>();
	/** Tracks the current real sessionId for each panelKey (absent entry means no real session yet) */
	private readonly panelKeyToSessionId = new Map<string, string>();
	/** Base (unprefixed) title for each chat panel, so we can re-derive the displayed title when the pending state toggles */
	private readonly panelKeyToBaseTitle = new Map<string, string>();
	/** Icon state for each chat panel: 'default' (orange), 'done' (green), 'pending' (blue) */
	private readonly panelKeyToIconState = new Map<string, 'default' | 'done' | 'pending'>();

	private static readonly PENDING_PREFIX = '● ';

	constructor(
		private readonly context: vscode.ExtensionContext,
		@ILogService private readonly logService: ILogService
	) {}

	/**
	 *  WebviewViewProvider.resolveWebviewView
	 */
	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void | Thenable<void> {
		this.logService.info(' WebView ');

		this.registerWebview(webviewView.webview, {
			host: 'sidebar',
			page: 'sessions'
		});

		// WebviewView  VSCode
		webviewView.onDidDispose(
			() => {
				this.removeWebview(webviewView.webview);
				this.logService.info(' WebView ');
			},
			undefined,
			this.context.subscriptions
		);

		this.logService.info(' WebView ');
	}

	/**
	 *  WebView
	 *  WebView  URI
	 */
	getWebView(): vscode.Webview | undefined {
		for (const webview of this.webviews) {
			return webview;
		}
		return undefined;
	}

	/**
	 *  WebView
	 */
	postMessage(message: any): void {
		if (this.webviews.size === 0) {
			this.logService.warn('[WebViewService]  WebView ');
			return;
		}

		const payload = {
			type: 'from-extension',
			message
		};

		const targetId = message?.webviewId as string | undefined;
		if (targetId) {
			const targetWebview = this.webviewIdMap.get(targetId);
			if (!targetWebview) {
				this.logService.warn(`[WebViewService]  WebView: ${targetId}`);
				return;
			}
			try {
				targetWebview.postMessage(payload);
			} catch (error) {
				this.logService.warn('[WebViewService]  WebView ', error as Error);
				this.removeWebview(targetWebview);
			}
			return;
		}

		//  WebView +
		const toRemove: vscode.Webview[] = [];

		for (const webview of this.webviews) {
			try {
				webview.postMessage(payload);
			} catch (error) {
				this.logService.warn('[WebViewService]  WebView ', error as Error);
				toRemove.push(webview);
			}
		}

		for (const webview of toRemove) {
			this.removeWebview(webview);
		}
	}

	/**
	 */
	setMessageHandler(handler: (message: any) => void): void {
		this.messageHandler = handler;
	}

	/**
	 */
	openEditorPage(page: string, title: string, instanceId?: string): void {
		const key = instanceId || page;
		const existing = this.editorPanels.get(key);
		if (existing) {
			try {
				existing.reveal(vscode.ViewColumn.Active);
				this.logService.info(`[WebViewService] : page=${page}, id=${key}`);
				return;
			} catch (error) {
				this.logService.warn(
					`[WebViewService] : page=${page}, id=${key}`,
					error as Error
				);
				this.editorPanels.delete(key);
			}
		}

		this.logService.info(`[WebViewService]  WebView : page=${page}, id=${key}`);

		const panel = vscode.window.createWebviewPanel(
			'relay.pageView',
			title,
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
					vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
				]
			}
		);

		const panelWebview = panel.webview;

		this.registerWebview(panelWebview, {
			host: 'editor',
			page,
			id: key
		});

		panel.onDidDispose(
			() => {
				this.removeWebview(panelWebview);
				this.editorPanels.delete(key);
				this.logService.info(`[WebViewService]  WebView : page=${page}, id=${key}`);
			},
			undefined,
			this.context.subscriptions
		);

		this.editorPanels.set(key, panel);
	}

	/**
	 */
	openChatPanel(sessionId: string | null, title: string): void {
		const key = sessionId || `new-chat-${Date.now()}`;
		const existing = this.chatPanels.get(key);
		if (existing) {
			try {
				existing.reveal(vscode.ViewColumn.Active);
				this.logService.info(`[WebViewService] : sessionId=${sessionId}`);
				return;
			} catch (error) {
				this.logService.warn(
					`[WebViewService] : sessionId=${sessionId}`,
					error as Error
				);
				this.chatPanels.delete(key);
			}
		}

		this.logService.info(`[WebViewService] : sessionId=${sessionId}, title=${title}`);

		const panel = vscode.window.createWebviewPanel(
			'relay.chatPanel',
			title,
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
					vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
				]
			}
		);

		// Track base title and initial icon state, then apply icon + title
		this.panelKeyToBaseTitle.set(key, title);
		this.panelKeyToIconState.set(key, 'default');
		this.applyPanelPresentation(key);

		const panelWebview = panel.webview;

		// Use key as the bootstrap id so the webviewId is always unique and
		// the webview knows which sessionId to pre-select (or '' for new session)
		const bootstrap: WebviewBootstrapConfig = { host: 'panel', page: 'chat', id: key, title };
		this.registerWebview(panelWebview, bootstrap);

		// Track webviewId → panelKey for title updates
		const webviewId = this.getWebviewId(bootstrap);
		this.chatPanelWebviewIds.set(webviewId, key);

		panel.onDidDispose(
			() => {
				this.removeWebview(panelWebview);
				this.chatPanels.delete(key);
				this.chatPanelWebviewIds.delete(webviewId);
				this.panelKeyToBaseTitle.delete(key);
				this.panelKeyToIconState.delete(key);
				const currentSessionId = this.panelKeyToSessionId.get(key);
				this.panelKeyToSessionId.delete(key);
				if (currentSessionId) {
					this.openSessionIds.delete(currentSessionId);
					this.persistOpenSessions();
				}
				this.logService.info(`[WebViewService] : sessionId=${currentSessionId}`);
			},
			undefined,
			this.context.subscriptions
		);

		if (sessionId) {
			this.panelKeyToSessionId.set(key, sessionId);
			this.openSessionIds.set(sessionId, title);
			this.persistOpenSessions();
		}

		this.chatPanels.set(key, panel);
	}

	/**
	 * @param webviewId  webviewId  'panel:chat:<key>' extension.ts
	 */
	updateChatPanelTitle(webviewId: string, title: string): void {
		const panelKey = this.chatPanelWebviewIds.get(webviewId);
		if (!panelKey) return;
		const panel = this.chatPanels.get(panelKey);
		if (panel) {
			this.panelKeyToBaseTitle.set(panelKey, title);
			this.applyPanelPresentation(panelKey);
			const currentSessionId = this.panelKeyToSessionId.get(panelKey);
			if (currentSessionId) {
				this.openSessionIds.set(currentSessionId, title);
				this.persistOpenSessions();
			}
			this.logService.info(`[WebViewService] : webviewId=${webviewId}, title=${title}`);
		}
	}

	/**
	 * Apply the current base title + icon state to the panel's `title` and `iconPath`.
	 * - pending: '● ' prefix + blue Claude logo (permission waiting)
	 * - done:    green Claude logo (turn completed)
	 * - default: orange Claude logo (idle or working)
	 */
	private applyPanelPresentation(panelKey: string): void {
		const panel = this.chatPanels.get(panelKey);
		if (!panel) return;
		const base = this.panelKeyToBaseTitle.get(panelKey) ?? panel.title;
		const state = this.panelKeyToIconState.get(panelKey) ?? 'default';
		const pending = state === 'pending';
		panel.title = pending ? WebViewService.PENDING_PREFIX + base : base;
		const iconFile = state === 'pending' ? 'claude-logo-pending.svg'
		               : state === 'done'    ? 'claude-logo-done.svg'
		               :                       'claude-logo.svg';
		const iconUri = vscode.Uri.file(path.join(this.context.extensionPath, 'resources', iconFile));
		panel.iconPath = { light: iconUri, dark: iconUri };
	}

	updateChatPanelSession(webviewId: string, sessionId: string | null): void {
		const panelKey = this.chatPanelWebviewIds.get(webviewId);
		if (!panelKey) return;
		const panel = this.chatPanels.get(panelKey);
		if (!panel) return;

		const previousSessionId = this.panelKeyToSessionId.get(panelKey);
		if (previousSessionId === sessionId) return;
		if (!previousSessionId && !sessionId) return;

		// Use the current persisted title if we had one, else fall back to the panel's base title
		// (prefer the unprefixed base title over panel.title, which may include the '●' pending prefix)
		const title = (previousSessionId && this.openSessionIds.get(previousSessionId))
			|| this.panelKeyToBaseTitle.get(panelKey)
			|| panel.title;

		if (previousSessionId) {
			this.openSessionIds.delete(previousSessionId);
		}

		if (sessionId) {
			this.panelKeyToSessionId.set(panelKey, sessionId);
			this.openSessionIds.set(sessionId, title);
		} else {
			this.panelKeyToSessionId.delete(panelKey);
		}

		this.persistOpenSessions();
		this.logService.info(
			`[WebViewService] : webviewId=${webviewId}, previousSessionId=${previousSessionId}, sessionId=${sessionId}`
		);
	}

	closeChatPanel(webviewId: string): void {
		const panelKey = this.chatPanelWebviewIds.get(webviewId);
		if (!panelKey) return;
		const panel = this.chatPanels.get(panelKey);
		if (panel) {
			panel.dispose();
			this.logService.info(`[WebViewService] : webviewId=${webviewId}`);
		}
	}

	updateChatPanelBadge(webviewId: string, count: number, iconState?: string): void {
		const panelKey = this.chatPanelWebviewIds.get(webviewId);
		if (!panelKey) return;
		if (!this.chatPanels.has(panelKey)) return;
		// Note: vscode.WebviewPanel has no `badge` property (that exists only on WebviewView/TreeView),
		// so we signal state by toggling a '●' title prefix and swapping the tab icon.
		const newState: 'default' | 'done' | 'pending' =
			iconState === 'pending' ? 'pending' :
			iconState === 'done'    ? 'done' :
			iconState === 'default' ? 'default' :
			// Legacy fallback: derive from count if iconState not provided
			count > 0               ? 'pending' : 'default';
		if (this.panelKeyToIconState.get(panelKey) !== newState) {
			this.panelKeyToIconState.set(panelKey, newState);
			this.applyPanelPresentation(panelKey);
		}
	}

	restoreOpenSessions(): void {
		const sessions = this.context.workspaceState.get<Array<{ sessionId: string; title: string }>>(
			WebViewService.OPEN_SESSIONS_KEY, []
		);
		for (const { sessionId, title } of sessions) {
			this.openChatPanel(sessionId, title);
		}
		this.logService.info(`[WebViewService] Restored ${sessions.length} session panel(s) from workspace state`);
	}

	private persistOpenSessions(): void {
		const sessions = Array.from(this.openSessionIds.entries()).map(([sessionId, title]) => ({ sessionId, title }));
		this.context.workspaceState.update(WebViewService.OPEN_SESSIONS_KEY, sessions);
	}

	/**
	 *  WebView  HTML
	 */
	private registerWebview(webview: vscode.Webview, bootstrap: WebviewBootstrapConfig): void {
		//  WebView
		webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
				vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
			]
		};

		this.webviews.add(webview);
		this.webviewConfigs.set(webview, bootstrap);
		const webviewId = this.getWebviewId(bootstrap);
		this.webviewIdMap.set(webviewId, webview);

		webview.onDidReceiveMessage(
			message => {
				this.logService.info(`[WebView → Extension] : ${message.type}`);
				if (this.messageHandler) {
					const taggedMessage =
						message && typeof message === 'object' ? { ...message, webviewId } : message;
					this.messageHandler(taggedMessage);
				}
			},
			undefined,
			this.context.subscriptions
		);

		//  WebView HTML/
		webview.html = this.getHtmlForWebview(webview, bootstrap);
	}

	/**
	 *  WebView HTML
	 */
	private getHtmlForWebview(webview: vscode.Webview, bootstrap: WebviewBootstrapConfig): string {
		const isDev = this.context.extensionMode === vscode.ExtensionMode.Development;
		const nonce = this.getNonce();

		if (isDev) {
			return this.getDevHtml(webview, nonce, bootstrap);
		}

		const extensionUri = vscode.Uri.file(this.context.extensionPath);
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'dist', 'media', 'main.js')
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'dist', 'media', 'style.css')
		);

		const csp = [
			`default-src 'none';`,
			`img-src ${webview.cspSource} https: data:;`,
			`style-src ${webview.cspSource} 'unsafe-inline' https://*.vscode-cdn.net;`,
			`font-src ${webview.cspSource} data:;`,
			`script-src ${webview.cspSource} 'nonce-${nonce}';`,
			`connect-src ${webview.cspSource} https:;`,
			`worker-src ${webview.cspSource} blob:;`,
		].join(' ');

		const bootstrapScript = `
    <script nonce="${nonce}">
      window.RELAY_BOOTSTRAP = ${JSON.stringify(bootstrap)};
    </script>`;

		return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claudex Chat</title>
    <link href="${styleUri}" rel="stylesheet" />
    ${bootstrapScript}
</head>
<body>
    <div id="app"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	private getDevHtml(webview: vscode.Webview, nonce: string, bootstrap: WebviewBootstrapConfig): string {
		//  dev server
		const devServer = process.env.VITE_DEV_SERVER_URL
			|| process.env.WEBVIEW_DEV_SERVER_URL
			|| `http://localhost:${process.env.VITE_DEV_PORT || 5173}`;

		let origin = '';
		let wsUrl = '';
		try {
			const u = new URL(devServer);
			origin = `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`;
			const wsProtocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
			wsUrl = `${wsProtocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`;
		} catch {
			origin = devServer; //
			wsUrl = 'ws://localhost:5173';
		}

		// Vite  CSP devServer  HMR  ws
		const csp = [
			`default-src 'none';`,
			`img-src ${webview.cspSource} 'self' https: data: blob: http: ${origin};`,
			`style-src ${webview.cspSource} 'unsafe-inline' ${origin} https://*.vscode-cdn.net;`,
			`font-src ${webview.cspSource} data: ${origin};`,
			`script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval' ${origin};`,
			`connect-src ${webview.cspSource} ${origin} ${wsUrl} https:;`,
			`worker-src ${webview.cspSource} blob:;`,
		].join(' ');

		const client = `${origin}/@vite/client`;
		const entry = `${origin}/src/main.ts`;

		const bootstrapScript = `
    <script nonce="${nonce}">
      window.RELAY_BOOTSTRAP = ${JSON.stringify(bootstrap)};
    </script>`;

		return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <base href="${origin}/" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claudex Chat (Dev)</title>
    ${bootstrapScript}
</head>
<body>
    <div id="app"></div>
    <script type="module" nonce="${nonce}" src="${client}"></script>
    <script type="module" nonce="${nonce}" src="${entry}"></script>
</body>
</html>`;
	}

	private getWebviewId(bootstrap: WebviewBootstrapConfig): string {
		return `${bootstrap.host}:${bootstrap.page ?? ''}:${bootstrap.id ?? ''}`;
	}

	private removeWebview(webview: vscode.Webview): void {
		this.webviews.delete(webview);
		const config = this.webviewConfigs.get(webview);
		if (config) {
			const webviewId = this.getWebviewId(config);
			this.webviewIdMap.delete(webviewId);
		}
		this.webviewConfigs.delete(webview);
	}

	/**
	 *  nonce
	 */
	private getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}
