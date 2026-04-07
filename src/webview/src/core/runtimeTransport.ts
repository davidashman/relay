import { VSCodeTransport } from '../transport/VSCodeTransport';
import { EventEmitter } from '../utils/events';

// Webview 宿主内的全局 Transport 单例
// 每个 Webview 进程各自拥有一份实例，但在同一宿主中只创建一次
export const atMentionEvents = new EventEmitter<string>();
export const selectionEvents = new EventEmitter<any>();

export const transport = new VSCodeTransport(atMentionEvents, selectionEvents);

