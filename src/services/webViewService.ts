/**
 * WebView 服务 / WebView Service
 *
 * 职责：
 * 1. 实现 vscode.WebviewViewProvider 接口
 * 2. 管理 WebView 实例和生命周期
 * 3. 生成 WebView HTML 内容
 * 4. 提供消息收发接口
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
	 * 获取当前的 WebView 实例（用于部分需要 webviewUri 的场景）
	 */
	getWebView(): vscode.Webview | undefined;

	/**
	 * 向所有已注册 WebView 实例广播消息
	 */
	postMessage(message: any): void;

	/**
	 * 设置消息接收处理器，所有 WebView 的消息都会通过该处理器转发
	 */
	setMessageHandler(handler: (message: any) => void): void;

	/**
	 * 打开（或聚焦）主编辑器中的某个页面
	 *
	 * @param page 页面类型标识，例如 'settings'、'diff'
	 * @param title VSCode 标签标题
	 * @param instanceId 页面实例 ID，用于区分多标签（不传则默认为 page，实现单例）
	 */
	openEditorPage(page: string, title: string, instanceId?: string): void;

	/**
	 * 打开（或聚焦）一个聊天面板
	 *
	 * @param sessionId 要加载的会话 ID；null 表示新会话
	 * @param title 面板标题
	 */
	openChatPanel(sessionId: string | null, title: string): void;

	/**
	 * 更新聊天面板标题（通过 webviewId 定位面板）
	 */
	updateChatPanelTitle(webviewId: string, title: string): void;

	/**
	 * 更新聊天面板当前关联的会话 ID，用于会话恢复跟踪最后活跃的会话
	 * （例如 /clear 在同一面板内创建新会话后调用）
	 */
	updateChatPanelSession(webviewId: string, sessionId: string | null): void;

	/**
	 * 关闭聊天面板（通过 webviewId 定位面板）
	 */
	closeChatPanel(webviewId: string): void;

	/**
	 * 更新聊天面板 badge 数字（通过 webviewId 定位面板）
	 * count > 0 shows the badge; count === 0 clears it
	 */
	updateChatPanelBadge(webviewId: string, count: number): void;

	/**
	 * Re-open chat panels that were open when the workspace was last closed.
	 * Should be called once during extension activation.
	 */
	restoreOpenSessions(): void;
}

/**
 * WebView 服务实现
 */
export class WebViewService implements IWebViewService {
	readonly _serviceBrand: undefined;

	private static readonly OPEN_SESSIONS_KEY = 'claudix.openSessions';

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
	/** Pending-permission state for each chat panel (drives title prefix + icon swap) */
	private readonly panelKeyToPending = new Map<string, boolean>();

	private static readonly PENDING_PREFIX = '● ';

	constructor(
		private readonly context: vscode.ExtensionContext,
		@ILogService private readonly logService: ILogService
	) {}

	/**
	 * 实现 WebviewViewProvider.resolveWebviewView（侧边栏宿主）
	 */
	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void | Thenable<void> {
		this.logService.info('开始解析侧边栏 WebView 视图');

		this.registerWebview(webviewView.webview, {
			host: 'sidebar',
			page: 'sessions'
		});

		// WebviewView 的销毁由 VSCode 管理，这里仅作日志记录
		webviewView.onDidDispose(
			() => {
				this.removeWebview(webviewView.webview);
				this.logService.info('侧边栏 WebView 视图已销毁');
			},
			undefined,
			this.context.subscriptions
		);

		this.logService.info('侧边栏 WebView 视图解析完成');
	}

	/**
	 * 获取当前的 WebView 实例
	 * 对于多 WebView 场景，这里返回任意一个可用实例（当前仅用于获取资源 URI）
	 */
	getWebView(): vscode.Webview | undefined {
		for (const webview of this.webviews) {
			return webview;
		}
		return undefined;
	}

	/**
	 * 广播消息到所有已注册的 WebView
	 */
	postMessage(message: any): void {
		if (this.webviews.size === 0) {
			this.logService.warn('[WebViewService] 当前没有可用的 WebView 实例，消息将被丢弃');
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
				this.logService.warn(`[WebViewService] 找不到目标 WebView: ${targetId}`);
				return;
			}
			try {
				targetWebview.postMessage(payload);
			} catch (error) {
				this.logService.warn('[WebViewService] 向目标 WebView 发送消息失败，将移除该实例', error as Error);
				this.removeWebview(targetWebview);
			}
			return;
		}

		// 广播到所有已注册的 WebView（侧边栏 + 所有聊天面板）
		const toRemove: vscode.Webview[] = [];

		for (const webview of this.webviews) {
			try {
				webview.postMessage(payload);
			} catch (error) {
				this.logService.warn('[WebViewService] 向 WebView 发送消息失败，将移除该实例', error as Error);
				toRemove.push(webview);
			}
		}

		for (const webview of toRemove) {
			this.removeWebview(webview);
		}
	}

	/**
	 * 设置消息接收处理器
	 */
	setMessageHandler(handler: (message: any) => void): void {
		this.messageHandler = handler;
	}

	/**
	 * 打开（或聚焦）主编辑器中的某个页面
	 */
	openEditorPage(page: string, title: string, instanceId?: string): void {
		const key = instanceId || page;
		const existing = this.editorPanels.get(key);
		if (existing) {
			try {
				existing.reveal(vscode.ViewColumn.Active);
				this.logService.info(`[WebViewService] 复用已存在的编辑器面板: page=${page}, id=${key}`);
				return;
			} catch (error) {
				// 可能遇到已被释放但还没从映射中移除的面板
				this.logService.warn(
					`[WebViewService] 现有编辑器面板已失效，将重新创建: page=${page}, id=${key}`,
					error as Error
				);
				this.editorPanels.delete(key);
			}
		}

		this.logService.info(`[WebViewService] 创建主编辑器 WebView 面板: page=${page}, id=${key}`);

		const panel = vscode.window.createWebviewPanel(
			'claudix.pageView',
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
				this.logService.info(`[WebViewService] 主编辑器 WebView 面板已销毁: page=${page}, id=${key}`);
			},
			undefined,
			this.context.subscriptions
		);

		this.editorPanels.set(key, panel);
	}

	/**
	 * 打开（或聚焦）一个聊天面板
	 */
	openChatPanel(sessionId: string | null, title: string): void {
		const key = sessionId || `new-chat-${Date.now()}`;
		const existing = this.chatPanels.get(key);
		if (existing) {
			try {
				existing.reveal(vscode.ViewColumn.Active);
				this.logService.info(`[WebViewService] 复用已存在的聊天面板: sessionId=${sessionId}`);
				return;
			} catch (error) {
				this.logService.warn(
					`[WebViewService] 现有聊天面板已失效，将重新创建: sessionId=${sessionId}`,
					error as Error
				);
				this.chatPanels.delete(key);
			}
		}

		this.logService.info(`[WebViewService] 创建聊天面板: sessionId=${sessionId}, title=${title}`);

		const panel = vscode.window.createWebviewPanel(
			'claudix.chatPanel',
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

		// Track base title and initial pending state, then apply icon + (prefixed) title
		this.panelKeyToBaseTitle.set(key, title);
		this.panelKeyToPending.set(key, false);
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
				this.panelKeyToPending.delete(key);
				const currentSessionId = this.panelKeyToSessionId.get(key);
				this.panelKeyToSessionId.delete(key);
				if (currentSessionId) {
					this.openSessionIds.delete(currentSessionId);
					this.persistOpenSessions();
				}
				this.logService.info(`[WebViewService] 聊天面板已销毁: sessionId=${currentSessionId}`);
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
	 * 更新聊天面板标题
	 * @param webviewId  webviewId 格式 'panel:chat:<key>'，由 extension.ts 从消息中提取
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
			this.logService.info(`[WebViewService] 更新聊天面板标题: webviewId=${webviewId}, title=${title}`);
		}
	}

	/**
	 * Apply the current base title + pending state to the panel's `title` and `iconPath`.
	 * A pending panel gets a '● ' prefix and a blue-accent Claude logo; a clean panel
	 * shows the base title and the default orange logo.
	 */
	private applyPanelPresentation(panelKey: string): void {
		const panel = this.chatPanels.get(panelKey);
		if (!panel) return;
		const base = this.panelKeyToBaseTitle.get(panelKey) ?? panel.title;
		const pending = this.panelKeyToPending.get(panelKey) ?? false;
		panel.title = pending ? WebViewService.PENDING_PREFIX + base : base;
		const iconFile = pending ? 'claude-logo-pending.svg' : 'claude-logo.svg';
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
			`[WebViewService] 更新聊天面板会话: webviewId=${webviewId}, previousSessionId=${previousSessionId}, sessionId=${sessionId}`
		);
	}

	closeChatPanel(webviewId: string): void {
		const panelKey = this.chatPanelWebviewIds.get(webviewId);
		if (!panelKey) return;
		const panel = this.chatPanels.get(panelKey);
		if (panel) {
			panel.dispose();
			this.logService.info(`[WebViewService] 关闭聊天面板: webviewId=${webviewId}`);
		}
	}

	updateChatPanelBadge(webviewId: string, count: number): void {
		const panelKey = this.chatPanelWebviewIds.get(webviewId);
		if (!panelKey) return;
		if (!this.chatPanels.has(panelKey)) return;
		// Note: vscode.WebviewPanel has no `badge` property (that exists only on WebviewView/TreeView),
		// so we signal "pending" by toggling a '●' title prefix and swapping the tab icon to a blue accent.
		const pending = count > 0;
		if (this.panelKeyToPending.get(panelKey) !== pending) {
			this.panelKeyToPending.set(panelKey, pending);
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
	 * 为给定 WebView 配置选项、消息通道和 HTML
	 */
	private registerWebview(webview: vscode.Webview, bootstrap: WebviewBootstrapConfig): void {
		// 配置 WebView 选项
		webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
				vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
			]
		};

		// 保存实例及其配置
		this.webviews.add(webview);
		this.webviewConfigs.set(webview, bootstrap);
		const webviewId = this.getWebviewId(bootstrap);
		this.webviewIdMap.set(webviewId, webview);

		// 连接消息处理器
		webview.onDidReceiveMessage(
			message => {
				this.logService.info(`[WebView → Extension] 收到消息: ${message.type}`);
				if (this.messageHandler) {
					const taggedMessage =
						message && typeof message === 'object' ? { ...message, webviewId } : message;
					this.messageHandler(taggedMessage);
				}
			},
			undefined,
			this.context.subscriptions
		);

		// 设置 WebView HTML（根据开发/生产模式切换）
		webview.html = this.getHtmlForWebview(webview, bootstrap);
	}

	/**
	 * 生成 WebView HTML
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
      window.CLAUDIX_BOOTSTRAP = ${JSON.stringify(bootstrap)};
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
		// 读取 dev server 地址（可通过环境变量覆盖）
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
			origin = devServer; // 回退（尽量允许）
			wsUrl = 'ws://localhost:5173';
		}

		// Vite 开发场景的 CSP：允许连接 devServer 与 HMR 的 ws
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
      window.CLAUDIX_BOOTSTRAP = ${JSON.stringify(bootstrap)};
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
	 * 生成随机 nonce
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
