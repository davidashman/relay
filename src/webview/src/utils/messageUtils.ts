/**
 * MessageUtils -
 *
 * rZe LSe
 */

import { Message } from '../models/Message';
import { ContentBlockWrapper } from '../models/ContentBlockWrapper';
import type { ToolResultBlock, ToolUseContentBlock, ContentBlockType } from '../models/ContentBlock';

/**
 * tool_use block
 *
 * function rZe(n, e) {
 *   for (let t = n.length - 1; t >= 0; t--) {
 *     let i = n[t];
 *     if (i.type === "assistant") {
 *       for (let o of i.content) {
 *         if (o.content.type === "tool_use" && o.content.id === e) {
 *           return o;
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * @param messages
 * @param toolUseId tool_use id
 * @returns ContentBlockWrapper tool_use
 */
export function findToolUseBlock(
    messages: Message[],
    toolUseId: string
): ContentBlockWrapper | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];

        // assistant
        if (message.type === 'assistant') {
            const content = message.message.content;

            // content ContentBlockWrapper[]
            if (Array.isArray(content)) {
                for (const wrapper of content) {
                    const found = findInWrapper(wrapper, toolUseId);
                    if (found) return found;
                }
            }
        }
    }

    return undefined;
}

/**
 * Recursively search a wrapper and its child tools for a matching tool_use id.
 * Task wrappers hold their subagent's tool_use blocks under `childTools`; this
 * walk lets tool_result attachment reach those nested tools.
 */
function findInWrapper(
    wrapper: ContentBlockWrapper,
    toolUseId: string
): ContentBlockWrapper | undefined {
    if (
        wrapper.content.type === 'tool_use' &&
        (wrapper.content as ToolUseContentBlock).id === toolUseId
    ) {
        return wrapper;
    }
    for (const child of wrapper.getChildToolsValue()) {
        const found = findInWrapper(child, toolUseId);
        if (found) return found;
    }
    return undefined;
}

/**
 * tool_result tool_use
 *
 * function LSe(n, e) {
 *   if (e.type === "user" && Array.isArray(e.message.content)) {
 *     for (let i of e.message.content) {
 *       if (i.type === "tool_result") {
 *         let o = rZe(n, i.tool_use_id);
 *         if (o) {
 *           o.setToolResult(i);
 *         }
 *       }
 *     }
 *   }
 *   let t = LJ(e);
 *   if (t) {
 *     n.push(t);
 *   }
 * }
 *
 * -
 * - tool_result blocks
 * - tool_use Signal
 *
 * @param messages
 * @param newMessage
 */
export function attachToolResults(messages: Message[], newMessage: Message): void {
    // user tool_result
    if (newMessage.type === 'user') {
        const content = newMessage.message.content;

        if (Array.isArray(content)) {
            for (const wrapper of content) {
                // tool_result
                if (wrapper.content.type === 'tool_result') {
                    const toolResult = wrapper.content as ToolResultBlock;
                    const toolUseId = toolResult.tool_use_id;

                    // tool_use
                    const toolUseWrapper = findToolUseBlock(messages, toolUseId);

                    if (toolUseWrapper) {
                        // Signal tool_result
                        toolUseWrapper.setToolResult(toolResult);
                    }
                }
            }
        }
    }
}

/**
 *
 * LSe
 *
 * @param messages
 * @param rawEvent
 */
export function processAndAttachMessage(messages: Message[], rawEvent: any): void {
    // 1. tool_result toolUseResult
    // tool_use
    if (rawEvent.type === 'user' && Array.isArray(rawEvent.message?.content)) {
        for (const block of rawEvent.message.content) {
            if (block.type === 'tool_result') {
                const toolUseWrapper = findToolUseBlock(messages, block.tool_use_id);
                if (toolUseWrapper) {
                    // tool_result
                    toolUseWrapper.setToolResult(block);

                    // toolUseResult
                    if (rawEvent.toolUseResult) {
                        toolUseWrapper.toolUseResult = rawEvent.toolUseResult;
                    }
                }
            }
        }
    }

    // 2. Message
    const message = Message.fromRaw(rawEvent);
    if (message) {
        messages.push(message);
    }
}

/**
 * Read ReadCoalesced IJ/ySe/CSe/iZe
 *
 * - assistant name === 'Read' tool_use
 * - tool_use tool_result
 * - assistant
 * - content tool_usename: 'ReadCoalesced'input: { fileReads: [...] }
 * - tool_use tool_result"Successfully read N files"
 */
export function mergeConsecutiveReadMessages(messages: Message[]): Message[] {
    const result: Message[] = [];
    let i = 0;

    while (i < messages.length) {
        const current = messages[i];
        if (isAssistantRead(current) && hasNonErrorToolResult(current)) {
            const group: Message[] = [current];
            let j = i + 1;
            while (j < messages.length) {
                const next = messages[j];
                if (isAssistantRead(next) && hasNonErrorToolResult(next)) {
                    group.push(next);
                    j++;
                } else {
                    break;
                }
            }

            if (group.length > 1) {
                result.push(buildReadCoalescedMessage(group));
                i = j;
                continue;
            }
        }

        result.push(current);
        i++;
    }

    return result;
}

function isAssistantRead(msg: Message): boolean {
    if (msg.type !== 'assistant') return false;
    const content = msg.message.content;
    if (typeof content === 'string' || !Array.isArray(content)) return false;
    return content.some(w => w.content.type === 'tool_use' && (w.content as ToolUseContentBlock).name === 'Read');
}

function firstReadToolUseWrapper(msg: Message): ContentBlockWrapper | undefined {
    const content = msg.message.content;
    if (typeof content === 'string' || !Array.isArray(content)) return undefined;
    return content.find(w => w.content.type === 'tool_use' && (w.content as ToolUseContentBlock).name === 'Read');
}

function hasNonErrorToolResult(msg: Message): boolean {
    const wrapper = firstReadToolUseWrapper(msg);
    if (!wrapper) return false;

    // 🔥 alien-signals APItoolResult signal
    const tr = wrapper.getToolResultValue();
    if (!tr) return false;
    return !tr.is_error;
}

function buildReadCoalescedMessage(group: Message[]): Message {
    // Read
    const fileReads = group.map(g => {
        const w = firstReadToolUseWrapper(g);
        const block = w?.content as ToolUseContentBlock | undefined;
        return block?.input ?? {};
    });

    const id = 'coalesced_' + Math.random().toString(36).slice(2);
    const toolUse: ToolUseContentBlock = {
        type: 'tool_use',
        id,
        name: 'ReadCoalesced',
        input: { fileReads }
    } as any;

    const wrapper = new ContentBlockWrapper(toolUse as unknown as ContentBlockType);
    const toolResult: ToolResultBlock = {
        type: 'tool_result',
        tool_use_id: id,
        content: `Successfully read ${group.length} files`,
        is_error: false
    } as any;
    wrapper.setToolResult(toolResult);

    return new Message(
        'assistant',
        {
            role: 'assistant',
            content: [wrapper]
        }
    );
}

/**
 * Read tool
 * @param message SDK
 * @returns boolean
 */
export function isReadToolMessage(message: any): boolean {
    if (message.type !== 'assistant') {
        return false;
    }

    return message.message.content.some(
        (block: any) =>
            block.type === 'tool_use' &&
            block.name === 'Read'
    );
}

/**
 * @param message SDK
 * @returns boolean
 */
export function isVisibleMessage(message: any): boolean {
    if (message.type !== 'assistant') {
        return true;
    }

    return message.message.content.some((block: any) => {
        if (block.type === 'text') {
            return block.text.trim() !== '';
        }
        return true; // tool_use
    });
}

/**
 * Read tool
 * UI Read tool
 *
 * @param messages SDK
 * @returns
 */
export function mergeConsecutiveReads(messages: any[]): any[] {
    const result: any[] = [];
    let i = 0;

    while (i < messages.length) {
        const current = messages[i];

        // Read tool
        if (isReadToolMessage(current) && isVisibleMessage(current)) {
            const readMessages: any[] = [current];

            // Read
            let j = i + 1;
            while (j < messages.length) {
                const next = messages[j];
                if (isReadToolMessage(next) && isVisibleMessage(next)) {
                    readMessages.push(next);
                    j++;
                } else {
                    break;
                }
            }

            // Read
            if (readMessages.length > 1) {
                const merged = mergeReadToolMessages(readMessages);
                result.push(merged);
                i = j;
            } else {
                result.push(current);
                i++;
            }
        } else {
            result.push(current);
            i++;
        }
    }

    return result;
}

/**
 * Read tool
 * @param messages Read tool
 * @returns
 */
function mergeReadToolMessages(messages: any[]): any {
    if (messages.length === 0) {
        throw new Error('Cannot merge empty messages array');
    }

    if (messages.length === 1) {
        return messages[0];
    }

    // tool_use
    const toolUseBlocks = messages.flatMap((msg) =>
        msg.message.content.filter((block: any) => block.type === 'tool_use')
    );

    const base = messages[0];

    return {
        ...base,
        message: {
            ...base.message,
            content: [
                {
                    type: 'text',
                    text: `[Merged ${toolUseBlocks.length} Read operations]`,
                    citations: null
                },
                ...toolUseBlocks
            ]
        }
    };
}

/**
 * @param message SDK
 * @returns
 */
export function extractMessageText(message: any): string {
    if (message.type === 'user') {
        const content = message.message.content;
        if (Array.isArray(content)) {
            return content
                .map((block: any) => {
                    if (typeof block === 'string') {
                        return block;
                    } else if (block.type === 'text') {
                        return block.text;
                    }
                    return '';
                })
                .join('\n');
        }
        return '';
    }

    if (message.type === 'assistant') {
        return message.message.content
            .map((block: any) => {
                if (block.type === 'text') {
                    return block.text;
                }
                return '';
            })
            .filter((text: string) => text.trim() !== '')
            .join('\n');
    }

    return '';
}

/**
 * @param message SDK
 * @returns boolean
 */
export function hasError(message: any): boolean {
    if (message.type === 'result') {
        return message.is_error === true;
    }
    return false;
}

/**
 * Token
 * @param message SDK
 * @returns Token
 */
export function estimateTokenCount(message: any): number {
    const text = extractMessageText(message);
    // 1 token ≈ 4
    return Math.ceil(text.length / 4);
}
