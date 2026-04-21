import { VSCodeTransport } from '../transport/VSCodeTransport';
import { EventEmitter } from '../utils/events';

// Webview Transport
// Webview
export const atMentionEvents = new EventEmitter<string>();
export const selectionEvents = new EventEmitter<any>();

export const transport = new VSCodeTransport(atMentionEvents, selectionEvents);

