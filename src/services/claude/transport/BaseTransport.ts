/**
 * BaseTransport -
 *
 *  Transport  Agent
 *
 * - VSCodeTransport: VSCode WebView
 * - NestJSTransport: NestJS WebSocket
 * - ElectronTransport: Electron IPC
 *
 * - send() onMessage()
 * -  API
 * -
 */

/**
 * Transport
 *
 *  Claude Agent WebView/WebSocket/IPC
 */
export interface ITransport {
    /**
     *
     * @param message -
     */
    send(message: any): void;

    /**
     *
     * @param callback -
     */
    onMessage(callback: (message: any) => void): void;
}

/**
 * Transport
 *
 */
export abstract class BaseTransport implements ITransport {
    protected messageCallback?: (message: any) => void;

    /**
     */
    abstract send(message: any): void;

    /**
     */
    onMessage(callback: (message: any) => void): void {
        this.messageCallback = callback;
    }

    /**
     */
    protected triggerMessage(message: any): void {
        if (this.messageCallback) {
            this.messageCallback(message);
        }
    }
}
