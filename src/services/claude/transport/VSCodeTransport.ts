/**
 * VSCodeTransport - VSCode WebView
 *
 * 1.  BaseTransport
 * 2.  WebViewService  VSCode WebView
 * 3.  Agent  WebView
 *
 * -  VSCode  API
 * -  DI
 * -  NestJS WebSocket
 */

import { BaseTransport } from './BaseTransport';
import { ILogService } from '../../logService';
import { IWebViewService } from '../../webViewService';

/**
 * VSCode WebView Transport
 */
export class VSCodeTransport extends BaseTransport {
    constructor(
        @IWebViewService private readonly webViewService: IWebViewService,
        @ILogService private readonly logService: ILogService
    ) {
        super();
        this.logService.info('[VSCodeTransport] ');
    }

    /**
     *  WebView
     */
    send(message: any): void {
        try {
            this.logService.info(`[VSCodeTransport] : ${message.type}`);
            this.webViewService.postMessage(message);
        } catch (error) {
            this.logService.error('[VSCodeTransport] :', error);
        }
    }
}
