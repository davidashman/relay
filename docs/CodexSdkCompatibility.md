# Codex SDK ↔ Claude Agent SDK Compatibility Analysis for Relay

## TL;DR

The two SDKs are **conceptually similar but mechanically incompatible**. Both wrap a native CLI binary, both stream events, both use MCP. But the message shapes, control surfaces, permission model, and extension points are different enough that you cannot just swap one import for another.

Adapting Relay to support Codex is **feasible and worth doing as an abstraction-layer refactor**, not a rewrite. The realistic shape is: introduce an `IAgentProvider` interface that both `ClaudeAgentService` and a new `CodexAgentService` implement, and add a normalization layer for events/messages so the webview renderer doesn't care which agent produced a message.

The hardest parts are (1) Codex has **no `canUseTool` callback** and **no `PreToolUse`/`PostToolUse` hooks** — Relay's permission modal flow needs a different mechanism (MCP elicitation), and (2) Codex has **no in-process custom tools** — anything Relay wanted to expose would need a subprocess MCP server.

---

## SDK Comparison Summary

| Concern | Claude Agent SDK | Codex SDK |
|---|---|---|
| Package | `@anthropic-ai/claude-agent-sdk` | `@openai/codex-sdk` (+ `@openai/codex` CLI) |
| Entry point | `query({ prompt, options })` async generator | `new Codex().startThread().runStreamed()` |
| Session model | Stateless + `options.resume: sessionId` | Stateful `Thread` object + `codex.resumeThread(id)` |
| Stream shape | `SDKMessage` (system / assistant / user / result) with `text`/`tool_use`/`thinking` blocks | `ThreadEvent` envelopes (`thread.started`, `turn.*`, `item.*`) wrapping typed `Item`s (`AgentMessageItem`, `CommandExecutionItem`, `FileChangeItem`, `McpToolCallItem`, `ReasoningItem`, `WebSearchItem`, `TodoListItem`, `ErrorItem`) |
| Built-in tools | Named allowlist (`Read`, `Edit`, `Bash`, `WebSearch`, …) | Implicit; gated by `sandbox_mode` + `approval_policy` + `web_search_enabled` |
| Custom tools | External MCP **and** in-process `createSdkMcpServer` | External MCP only (no in-process API) |
| Permission gate | `canUseTool(name, input)` callback + `permissionMode` (`default`/`acceptEdits`/`bypassPermissions`/`plan`) | `approval_policy` (`untrusted`/`on-request`/`never`/granular) + `sandbox_mode` (`read-only`/`workspace-write`/`danger-full-access`); approvals delivered via MCP **elicitation** round-trips |
| Hooks | `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, … | **None** |
| Subagents | First-class `agents: {…}` + `Agent` tool | None |
| Forking | Yes | No (linear threads) |
| System prompt | `systemPrompt`/`appendSystemPrompt` programmatic + `CLAUDE.md` | `AGENTS.md` + `model_instructions_file` + `developer_instructions` |
| Mid-turn control | `query.setModel()`, `query.setPermissionMode()`, `query.setMaxThinkingTokens()`, `query.interrupt()` | Only `thread.sendBackgroundEvent()`; model/approval changes require a new turn/thread |
| Configuration | Programmatic `ClaudeAgentOptions` | TOML (`~/.codex/config.toml`) overridable via `config: {…}` flattened to `--config k=v` flags |
| Models | `claude-*` | `gpt-5-codex`, `gpt-5.4`, etc.; `model_reasoning_effort` (`minimal`→`xhigh`) |

---

## Where Relay Currently Couples to the Claude SDK

Today's seams:

- [src/services/claude/ClaudeSdkService.ts](../src/services/claude/ClaudeSdkService.ts) — direct call to `query({ prompt: inputStream, options })` at line 338, builds the SDK options object (lines 204–314), exposes `interrupt()`, `probe()`. This is the thinnest layer over the SDK.
- [src/services/claude/ClaudeAgentService.ts](../src/services/claude/ClaudeAgentService.ts) — orchestrator. Iterates the `Query` async generator (line 432), forwards each `SDKMessage` to the transport (line 436), wires `canUseTool` (lines 387–392), exposes `setModel`/`setPermissionMode`/`setMaxThinkingTokens` (lines 914/939/953). This is where the SDK's control surface leaks the most.
- [src/shared/messages.ts](../src/shared/messages.ts) — re-exports `SDKMessage`, `SDKUserMessage`, `PermissionMode` directly from the SDK (lines 6–13). **The webview consumes Claude SDK types verbatim.** This is the biggest renderer coupling.
- [src/webview/src/core/Session.ts](../src/webview/src/core/Session.ts), [src/webview/src/components/Messages/MessageRenderer.vue](../src/webview/src/components/Messages/MessageRenderer.vue), [src/webview/src/components/Messages/blocks/](../src/webview/src/components/Messages/blocks/) — render `assistant.content` blocks (`text`/`tool_use`/`thinking`) directly.
- [src/webview/src/core/PermissionRequest.ts](../src/webview/src/core/PermissionRequest.ts) + [src/webview/src/components/PermissionRequestModal.vue](../src/webview/src/components/PermissionRequestModal.vue) — assume synchronous `canUseTool` shape with `{ behavior, message?, updatedInput?, updatedPermissions?, interrupt? }`.

Already-decoupled seams that help:

- `IClaudeSdkService` interface and DI via [src/services/serviceRegistry.ts](../src/services/serviceRegistry.ts).
- Transport layer `ITransport` ([src/services/claude/transport/BaseTransport.ts](../src/services/claude/transport/BaseTransport.ts)) — webview already consumes JSON over a queue, so a normalization layer can sit before serialization.
- Handler registry pattern in [src/services/claude/handlers/handlers.ts](../src/services/claude/handlers/handlers.ts).

---

## Mapping Matrix

| Relay needs | Claude SDK | Codex SDK | Adaptation effort |
|---|---|---|---|
| Start a turn | `query({ prompt, options })` | `thread.runStreamed(input, turnOptions)` | Low — wrap behind `IAgentProvider.startTurn()` |
| Stream assistant text | `SDKMessage` w/ `assistant.content[].type==='text'` | `ItemCompletedEvent` w/ `AgentMessageItem` | Low — normalize to `{ kind:'text', text }` |
| Tool call render | `tool_use` block w/ `name` + `input` | `CommandExecutionItem` / `FileChangeItem` / `McpToolCallItem` / `WebSearchItem` / `TodoListItem` | Medium — split renderers per item kind, map to common `ToolCall` shape |
| Tool result render | Subsequent `user.content[].type==='tool_result'` | Embedded fields on the item itself (e.g. `stdout`/`exitCode` on command item) | Medium — collapse into the same `ToolCall` |
| Reasoning / thinking | `thinking` block | `ReasoningItem` (gated by `show_raw_agent_reasoning`) | Low |
| Session id | `system` init message | `ThreadStartedEvent` | Low |
| Resume | `options.resume` | `codex.resumeThread(id)` | Low |
| Cwd | `options.cwd` | `ThreadOptions.workingDirectory` (must be a git repo unless `skipGitRepoCheck`) | Low |
| System prompt | `systemPrompt` / `appendSystemPrompt` | `AGENTS.md` file + `developer_instructions` | Medium — Relay would write a temp `AGENTS.md` or use `developer_instructions` |
| Tool permission gate | `canUseTool(name, input)` callback | MCP elicitation handler (`elicitation/create` → `ExecApprovalElicitRequestParams`/`PatchApprovalElicitRequestParams`) | **High — this is the hardest one.** Relay must run a small MCP elicitation server to drive the existing modal |
| Permission modes | `permissionMode` | `approval_policy` + `sandbox_mode` | Medium — `plan` mode has no direct analog; closest is `sandbox_mode:'read-only'` + `approval_policy:'never'` |
| Mid-turn `setModel` / `setPermissionMode` | `query.setModel(...)` etc. | None — must restart the turn or thread | Medium — gray out the controls, or queue change for next turn |
| Hooks (PreToolUse/PostToolUse) | `hooks: [...]` | None | Medium — if Relay only logs, drop it for Codex; if it ever blocks, must pre-empt via MCP |
| MCP servers | `options.mcpServers` programmatic | TOML in `config.toml`, or `config: { mcp_servers: {…} }` override | Low |
| In-process tools | `createSdkMcpServer` | None — must spawn a subprocess MCP server | Medium-High if/when Relay adds custom tools |
| Subagents (`Agent` tool) | Native | None | Skip for Codex; degrade gracefully |
| Skills, slash commands | Native | None | Skip / hide for Codex |
| Interrupt | `query.interrupt()` | Kill the underlying CLI process | Medium |
| Probe (`supportedModels`, `mcpServerStatus`, `accountInfo`) | Native methods on `Query` | Different APIs — `codex` CLI subcommands or no equivalent | Medium — define `IAgentProvider.probe()` per-provider |

---

## Difficulty Verdict

Relay's architecture is well-suited for this — it already has DI, an `IClaudeSdkService` interface, a transport boundary, and a handler pattern. But the **renderer consumes raw `SDKMessage` types**, which is the biggest pain point.

Rough effort breakdown for full Codex parity (single-developer estimates, in story-point order, not time):

1. **Normalization layer** (medium): define a `NormalizedAgentMessage` union (`text`, `tool_call`, `tool_result`, `reasoning`, `error`, `turn_start`, `turn_end`, `session_init`) and a `NormalizedToolCall` (`{ id, kind, name, input, output?, status }`). Refactor [src/shared/messages.ts](../src/shared/messages.ts) to stop re-exporting `SDKMessage` and use the normalized type instead. Update `MessageRenderer.vue` and tool block components to render from the normalized type. Most existing Claude logic becomes `ClaudeAgentProvider.normalize(sdkMessage)`.
2. **`IAgentProvider` interface** (low): extract from `ClaudeAgentService`/`ClaudeSdkService`. Methods: `startTurn`, `streamEvents`, `resume`, `interrupt`, `probe`, `setModel?`, `setPermissionMode?`. Make `setModel`/`setPermissionMode` optional and have the UI gracefully disable them when the provider returns "unsupported".
3. **`ClaudeAgentProvider`** (low): rename / move existing code under the new interface.
4. **`CodexAgentProvider`** (medium-high): wrap `@openai/codex-sdk`, translate `ThreadEvent`/`Item` to normalized messages, manage `Thread` lifecycle, map config.
5. **Permission bridge for Codex** (high): implement an in-process MCP server that handles `elicitation/create` and surfaces requests to `PermissionRequestModal.vue` with the existing `PermissionRequest` API. Configure Codex with `approval_policy: 'on-request'` so it actually asks. This is the riskiest piece — requires understanding Codex's elicitation schema, which is partly undocumented.
6. **Settings / model picker** (low-medium): add provider switch in settings, gate model lists per provider, gate MCP/agents/skills tabs that don't apply to Codex.
7. **System prompt handling** (medium): write a temp `AGENTS.md` per session (or use `developer_instructions` config override) so Relay's existing system-prompt customization still works.
8. **Auth** (low): surface `OPENAI_API_KEY` / `CODEX_API_KEY` in Relay settings; document ChatGPT login alternative.
9. **Graceful degradation** (low, scattered): hide/disable Plan mode, subagents, hooks UI, skills tab, slash commands tab, `query.setModel` mid-turn, etc., when Codex provider is active.

**Overall: feasible. The refactor is concentrated in two places (the normalization layer + the permission bridge); everything else is straightforward provider glue.**

---

## Key Risks / Open Questions

1. **MCP elicitation in `@openai/codex-sdk` TS:** the docs imply elicitation is wired through the CLI TUI; whether the TS SDK exposes it as a programmatic event needs source-reading in `openai/codex` to confirm.
2. **Streaming granularity of `CommandExecutionItem`:** does it stream stdout chunks via `item.updated`, or only deliver the full output on `item.completed`? This affects whether long-running Bash output feels live in Relay.
3. **`RunResult` shape:** whether it includes the full item list or only `finalResponse` — affects resume rendering.
4. **No `query.setModel()` / `query.setPermissionMode()` analog:** Relay's UX of switching mid-turn would need to be either disabled or implemented as "applies to next turn".
5. **No Plan mode equivalent:** product decision needed — disable Plan mode UI when Codex is selected, or approximate it with `sandbox_mode: read-only` + `approval_policy: never`.
6. **No subagents / skills / slash commands in Codex:** these Relay surfaces would be Claude-only.
7. **Workspace dir must be a git repo for Codex** unless `skipGitRepoCheck: true` is set — Relay should set this or surface a clear error.

---

## Critical Files (for the eventual implementation)

- [src/shared/messages.ts](../src/shared/messages.ts) — biggest change: stop re-exporting SDK types, introduce normalized types
- [src/services/claude/ClaudeSdkService.ts](../src/services/claude/ClaudeSdkService.ts) — becomes Claude-specific provider
- [src/services/claude/ClaudeAgentService.ts](../src/services/claude/ClaudeAgentService.ts) — split: provider-agnostic orchestration vs Claude-specific glue
- [src/services/serviceRegistry.ts](../src/services/serviceRegistry.ts) — register provider by setting
- [src/webview/src/core/Session.ts](../src/webview/src/core/Session.ts) — consume normalized types
- [src/webview/src/components/Messages/MessageRenderer.vue](../src/webview/src/components/Messages/MessageRenderer.vue) and [src/webview/src/components/Messages/blocks/](../src/webview/src/components/Messages/blocks/) — render normalized types
- [src/webview/src/core/PermissionRequest.ts](../src/webview/src/core/PermissionRequest.ts) + [src/webview/src/components/PermissionRequestModal.vue](../src/webview/src/components/PermissionRequestModal.vue) — keep API, add Codex elicitation source
- New: `src/services/agent/IAgentProvider.ts`, `src/services/agent/ClaudeAgentProvider.ts`, `src/services/agent/CodexAgentProvider.ts`, `src/services/agent/normalize.ts`
- New: `src/services/agent/CodexElicitationMcpServer.ts`

---

## References

- [OpenAI Developers — Codex SDK](https://developers.openai.com/codex/sdk)
- [OpenAI Developers — Codex CLI](https://developers.openai.com/codex/cli)
- [OpenAI Developers — Codex MCP](https://developers.openai.com/codex/mcp)
- [OpenAI Developers — Codex Configuration Reference](https://developers.openai.com/codex/config-reference)
- [GitHub — openai/codex TypeScript SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)
- [npm — @openai/codex-sdk](https://www.npmjs.com/package/@openai/codex-sdk)
- [DeepWiki — Codex Approval System and User Review](https://deepwiki.com/openai/codex/6.4-approval-system-and-user-review)
- [Claude Agent SDK — Overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [GitHub — anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript)

---

If you want to start the refactor, the natural first PR is just **the normalization layer + `IAgentProvider` extraction**, with only the Claude provider implemented. That alone is valuable (decouples renderer from SDK types) and unblocks adding any future provider.
