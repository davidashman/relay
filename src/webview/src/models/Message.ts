/**
 * Message -
 *
 * 1.
 * 2. isEmpty getter
 * 3. ContentBlockWrapper tool_result
 */

import type { ContentBlockType } from '../models/ContentBlock';
import { parseMessageContent } from '../models/contentParsers';
import { ContentBlockWrapper } from '../models/ContentBlockWrapper';

/**
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'result' | 'tip' | 'slash_command_result' | 'compaction';

/**
 */
export interface MessageData {
  role: MessageRole;
  content: string | ContentBlockWrapper[];
}

/**
 *
 * - user/assistant content ContentBlockWrapper[]
 * - system/result content string
 */
export class Message {
  type: MessageRole;
  message: MessageData;
  timestamp: number;

  // system result
  subtype?: string;
  session_id?: string;
  is_error?: boolean;

  constructor(
    type: MessageRole,
    message: MessageData,
    timestamp: number = Date.now(),
    extra?: {
      subtype?: string;
      session_id?: string;
      is_error?: boolean;
    }
  ) {
    this.type = type;
    this.message = message;
    this.timestamp = timestamp;

    if (extra) {
      this.subtype = extra.subtype;
      this.session_id = extra.session_id;
      this.is_error = extra.is_error;
    }
  }

  /**
   * isEmpty getter - ""
   *
   * 1. system empty
   * 2. user/assistant
   * - → empty
   * - tool_result → empty
   */
  get isEmpty(): boolean {
    // system empty
    if (this.type === 'system') {
      return false;
    }

    const content = this.message.content;

    // empty
    if (typeof content === 'string') {
      return content.length === 0;
    }

    // ContentBlockWrapper
    if (Array.isArray(content)) {
      // → empty
      if (content.length === 0) {
        return true;
      }

      // tool_result → empty
      return content.every((wrapper) => wrapper.content.type === 'tool_result');
    }

    return false;
  }

  /**
   * - Message
   *
   * @param raw
   * @returns Message null
   */
  static fromRaw(raw: any): Message | null {
    if (raw.type === 'user' || raw.type === 'assistant') {
      const rawContent = Array.isArray(raw.message?.content)
        ? raw.message.content
        : raw.message?.content !== undefined
          ? [{ type: 'text', text: String(raw.message.content) }]
          : [];

      // content
      const contentBlocks = parseMessageContent(rawContent);

      // ContentBlockWrapper
      const wrappedContent = contentBlocks.map((block) => new ContentBlockWrapper(block));

      // contentParsers
      let messageType: MessageRole = raw.type;

      if (raw.type === 'user') {
        const specialType = getSpecialMessageType(contentBlocks);
        if (specialType) {
          messageType = specialType;
        }
      }

      return new Message(
        messageType,
        {
          role: raw.message?.role ?? raw.type,
          content: wrappedContent,
        },
        raw.timestamp || Date.now()
      );
    }

    // system
    if (raw.type === 'system') {
      return null;
    }

    // result /
    if (raw.type === 'result') {
      return null;
    }

    // stream_event
    return null;
  }
}

/**
 */
export function isUserMessage(msg: Message): boolean {
  return msg.type === 'user';
}

export function isAssistantMessage(msg: Message): boolean {
  return msg.type === 'assistant';
}

export function isSystemMessage(msg: Message): boolean {
  return msg.type === 'system';
}

export function isResultMessage(msg: Message): boolean {
  return msg.type === 'result';
}

/**
 *
 * contentParsers.ts
 */
function getSpecialMessageType(contentBlocks: ContentBlockType[]): MessageRole | null {
  if (contentBlocks.length === 1) {
    const blockType = contentBlocks[0].type;

    if (blockType === 'interrupt' || blockType === 'llm_error') {
      return 'tip';
    }

    if (blockType === 'slash_command_result') {
      return 'slash_command_result';
    }
  }

  return null;
}
