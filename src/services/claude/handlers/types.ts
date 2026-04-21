/**
 * Handler
 *
 *  handler
 */

import { ILogService } from '../../logService';
import { IConfigurationService } from '../../configurationService';
import { IWorkspaceService } from '../../workspaceService';
import { IFileSystemService } from '../../fileSystemService';
import { INotificationService } from '../../notificationService';
import { ITerminalService } from '../../terminalService';
import { ITabsAndEditorsService } from '../../tabsAndEditorsService';
import { IClaudeSessionService } from '../ClaudeSessionService';
import { IClaudeSdkService } from '../ClaudeSdkService';
import { IClaudeAgentService } from '../ClaudeAgentService';
import { IWebViewService } from '../../webViewService';

/**
 * Handler
 *  VS Code  API
 */
export interface HandlerContext {
    logService: ILogService;
    configService: IConfigurationService;
    workspaceService: IWorkspaceService;
    fileSystemService: IFileSystemService;
    notificationService: INotificationService;
    terminalService: ITerminalService;
    tabsAndEditorsService: ITabsAndEditorsService;
    sessionService: IClaudeSessionService;
    sdkService: IClaudeSdkService;
    agentService: IClaudeAgentService;
    webViewService: IWebViewService;
}

/**
 * Handler
 */
export type HandlerFunction<TRequest = any, TResponse = any> = (
    request: TRequest,
    context: HandlerContext,
    signal?: AbortSignal
) => Promise<TResponse>;
