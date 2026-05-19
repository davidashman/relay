/**
 * Local type definitions for the Claude CLI process layer.
 * Only types that differ from (or aren't in) the SDK are defined here.
 * Shared protocol types (PermissionResult, PermissionUpdate, SDKMessage, etc.)
 * continue to be imported from @anthropic-ai/claude-agent-sdk as devDependency.
 */

import type {
    SDKMessage,
    PermissionMode,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Minimal Query interface satisfied by ProcessQuery.
 * Replaces the SDK's Query (AsyncGenerator subtype) with only the methods
 * ClaudeAgentService actually calls.
 */
export interface Query extends AsyncIterable<SDKMessage> {
    next(): Promise<IteratorResult<SDKMessage, void>>;
    return(value?: unknown): Promise<IteratorResult<SDKMessage, void>>;
    interrupt(): Promise<void>;
    setPermissionMode(mode: PermissionMode): Promise<void>;
    setModel(model: string): Promise<void>;
    setMaxThinkingTokens(max: number | null): Promise<void>;
    // Optional probe methods used by loadConfig() in handlers.ts
    supportedCommands?(): Promise<unknown[]>;
    supportedModels?(): Promise<unknown[]>;
    accountInfo?(): Promise<unknown>;
    mcpServerStatus?(): Promise<unknown[]>;
}
