# Claude Code Settings System Reference

> Complete reference documentation for the Relay extension settings system. Based on the [Claude Code official documentation](https://code.claude.com/docs/en/settings).

---

## 1. Configuration System Architecture

### 1.1 Scope Levels (highest to lowest priority)

| Scope | Location | Effect | Team-shared |
|-------|----------|--------|------------|
| **Managed** | system directory `managed-settings.json` | all users (enterprise IT deployment) | Yes |
| **CLI** | command-line arguments `--model`, `--model-provider`, etc. | current session | No |
| **Local** | `.claude/settings.local.json` (project directory) | current user, current project | No (gitignored) |
| **Project (Shared)** | `.claude/settings.json` (project directory) | all collaborators | Yes (git) |
| **User (Global)** | `~/.claude/settings.json` or `~/.claude/settings.{profile}.json` | current user, all projects | No |
| **Default** | built-in defaults | everyone | — |

**System directory paths:**
- macOS: `/Library/Application Support/ClaudeCode/`
- Linux: `/etc/claude-code/`
- Windows: `C:\Program Files\ClaudeCode\`

### 1.2 Three Data Pipelines

The Relay extension maintains three independent data pipelines:

```
Pipeline A: CC Settings (settings.json file family)
  ├── Write: updateSetting(key, value, scope)
  ├── Read:  getSettings() / inspect(key)
  └── Covers Tabs: General / Models / Agent / Permissions / Hooks
                   / Sandbox / Network / Environments

Pipeline B: Extension Config (~/.relay.json)
  ├── Write: updateExtensionConfig(key, value)
  ├── Read:  getExtensionConfig()
  └── Covers Tabs: Profiles (activeProfile), Models (customModels),
                   General (systemNotifications, completionSound)

Pipeline C: MCP Config (~/.claude.json + .mcp.json)
  ├── Write: CLI commands (claude mcp add/remove) or direct file ops
  ├── Read:  parse ~/.claude.json and .mcp.json
  └── Covers Tab: MCP Servers (server list CRUD)
  └── Note: MCP policy controls (enabledMcpjsonServers, etc.) go through Pipeline A
```

### 1.3 Shadow Config

```
~/.claude/relay.json = copy of the active Profile's settings.json
passed to the SDK CLI via --settings flag
purely an implementation detail, not directly visible to the UI layer
```

---

## 2. Settings Keys Reference

### 2.1 Core Settings

| Key | Type | Description | Example | Tab |
|-----|------|-------------|---------|-----|
| `model` | string | Override default model (alias or full model ID) | `"opus"`, `"claude-sonnet-4-5-20250929"` | Models |
| `effortLevel` | `"low" \| "medium" \| "high"` | Opus 4.6+ adaptive reasoning effort | `"high"` | Models |
| `alwaysThinkingEnabled` | boolean | Enable extended thinking by default | `true` | Models |
| `language` | string | Claude response language preference | `"japanese"` | General |
| `outputStyle` | string | Output style adjustment | `"Explanatory"` | Agent |
| `agent` | string | Specify agent | — | Agent |
| `apiKeyHelper` | string | Custom script to generate auth value | `"/bin/generate_temp_api_key.sh"` | General (Advanced) |
| `companyAnnouncements` | string[] | Startup announcements (random when multiple) | `["Welcome message"]` | Memory & Rules |
| `attribution` | `{ commit?: string, pr?: string }` | Custom Git commit/PR attribution | `{"commit": "Generated with Claude", "pr": ""}` | General |
| `includeCoAuthoredBy` | boolean | **Deprecated**: use `attribution` instead | `false` | — |
| `cleanupPeriodDays` | number | Days before inactive sessions are deleted (0=immediately) | `20` | General |
| `forceLoginMethod` | `"claudeai" \| "console"` | Restrict login type | `"claudeai"` | General |
| `forceLoginOrgUUID` | string | Auto-select organization UUID on login | `"xxx-xxx"` | General |
| `autoUpdatesChannel` | `"stable" \| "latest"` | Update channel | `"stable"` | General |

### 2.2 UI & Experience Settings

| Key | Type | Description | Tab |
|-----|------|-------------|-----|
| `showTurnDuration` | boolean | Show turn duration after responses | General |
| `spinnerTipsEnabled` | boolean | Show tips in spinner | General |
| `spinnerVerbs` | `{ mode: string, verbs: string[] }` | Custom spinner verbs | General |
| `terminalProgressBarEnabled` | boolean | Terminal progress bar | General |
| `prefersReducedMotion` | boolean | Reduce UI animations (accessibility) | General |
| `statusLine` | `{ type: string, command: string }` | Custom status line | Agent |
| `plansDirectory` | string | Plan file storage path (relative to project) | Agent |
| `fileSuggestion` | `{ type: string, command: string }` | Custom `@` file autocomplete script | Agent |
| `respectGitignore` | boolean | Exclude files matched by .gitignore | Agent |
| `teammateMode` | `"auto" \| "in-process" \| "tmux"` | Agent team display mode | Agent |

### 2.3 Permission Settings

```jsonc
{
  "permissions": {
    "allow": ["Bash(npm run lint)", "Bash(npm run test *)", "Read(~/.zshrc)"],
    "deny": ["Bash(curl *)", "Read(./.env)", "Read(./secrets/**)"],
    "ask": ["Bash(git push *)"],
    "defaultMode": "acceptEdits",           // default permission mode
    "additionalDirectories": ["../docs/"],  // additional directories allowed for access
    "disableBypassPermissionsMode": "disable"
  }
}
```

**Permission rule syntax:** `Tool` or `Tool(specifier)`

| Rule | Effect |
|------|--------|
| `Bash` | all bash commands |
| `Bash(npm run *)` | commands starting with `npm run` |
| `Read(./.env)` | read .env file |
| `Edit(./src/**)` | edit files under src/ |
| `WebFetch(domain:example.com)` | fetch requests to example.com |

**Evaluation order:** Deny → Ask → Allow (first match wins)

**Tab:** Permissions

### 2.4 Hooks Settings

```jsonc
{
  "hooks": {
    "SessionStart": [{ "type": "command", "command": "echo session started" }],
    "SessionEnd": [...],
    "UserPromptSubmit": [...],
    "PreToolUse": [...],
    "PostToolUse": [...],
    "PostToolUseFailure": [...],
    "PermissionRequest": [...],
    "Stop": [...],
    "SubagentStart": [...],
    "SubagentStop": [...],
    "Notification": [...],
    "TeammateIdle": [...],
    "TaskCompleted": [...],
    "PreCompact": [...]
  },
  "disableAllHooks": false,
  "allowManagedHooksOnly": false   // Managed only
}
```

**Supports 14 lifecycle events.** Tab: Hooks

### 2.5 Sandbox Settings

```jsonc
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["docker"],
    "allowUnsandboxedCommands": false,
    "enableWeakerNestedSandbox": false,
    "network": {
      "allowedDomains": ["github.com", "*.npmjs.org"],
      "allowUnixSockets": ["~/.ssh/agent-socket"],
      "allowAllUnixSockets": false,
      "allowLocalBinding": true,
      "httpProxyPort": 8080,
      "socksProxyPort": 1080
    }
  }
}
```

**Tab:** Sandbox

### 2.6 MCP Server Policy Settings

| Key | Type | Description | Managed Only |
|-----|------|-------------|-------------|
| `enableAllProjectMcpServers` | boolean | Auto-approve all `.mcp.json` servers | No |
| `enabledMcpjsonServers` | string[] | Approved `.mcp.json` servers | No |
| `disabledMcpjsonServers` | string[] | Denied `.mcp.json` servers | No |
| `allowedMcpServers` | object[] | MCP server allow list | **Yes** |
| `deniedMcpServers` | object[] | MCP server deny list | **Yes** |

**Tab:** MCP Servers

> **Note:** The actual MCP server configuration is stored in `~/.claude.json` and `.mcp.json` (Pipeline C).
> The keys above are only policy controls, stored in settings.json (Pipeline A).

### 2.7 Plugin Settings

```jsonc
{
  "enabledPlugins": {
    "formatter@acme-tools": true,
    "deployer@acme-tools": true
  },
  "extraKnownMarketplaces": {
    "acme-tools": {
      "source": { "source": "github", "repo": "acme-corp/claude-plugins" }
    }
  },
  "skippedMarketplaces": [],
  "skippedPlugins": [],
  "pluginConfigs": {},
  "strictKnownMarketplaces": []    // Managed only
}
```

**Tab:** None yet (can be merged into MCP Servers or a separate Plugins tab)

### 2.8 Advanced / Enterprise Settings

| Key | Type | Description | Managed Only |
|-----|------|-------------|-------------|
| `otelHeadersHelper` | string | Dynamic OpenTelemetry headers script | No |
| `awsAuthRefresh` | string | AWS auth refresh command | No |
| `awsCredentialExport` | string | AWS credential export script | No |
| `remote.defaultEnvironmentId` | string | Default environment ID for remote sessions | No |
| `allowManagedPermissionRulesOnly` | boolean | Only allow managed permission rules | **Yes** |
| `allowManagedHooksOnly` | boolean | Only load managed hooks | **Yes** |

---

## 3. Environment Variables Reference

Environment variables are stored in the `env` object in settings.json, but the **UI layer splits them across tabs by purpose**.

### 3.1 Model-related (Models Tab)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_MODEL` | Global model override (alias or full ID) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Override the actual model routed by the `opus` alias |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Override the actual model routed by `sonnet` / `default` alias |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Override the actual model routed by the `haiku` alias |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Model used by sub-agents |
| `CLAUDE_CODE_EFFORT_LEVEL` | Opus 4.6+ effort level: `low`, `medium`, `high` |
| `MAX_THINKING_TOKENS` | Extended thinking token limit (0=disabled) |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Max output tokens (default 32000, max 64000) |
| `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` | File read token limit |

### 3.2 Authentication (General / not in UI)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key |
| `ANTHROPIC_AUTH_TOKEN` | Custom Authorization header value |
| `ANTHROPIC_CUSTOM_HEADERS` | Custom headers (`Name: Value` format, newline-separated) |

### 3.3 Network & Proxy (Network Tab)

| Variable | Description |
|----------|-------------|
| `HTTP_PROXY` | HTTP proxy server |
| `HTTPS_PROXY` | HTTPS proxy server |
| `NO_PROXY` | Domains/IPs to bypass proxy |
| `CLAUDE_CODE_PROXY_RESOLVES_HOSTS` | Allow proxy DNS resolution |
| `CLAUDE_CODE_CLIENT_CERT` | mTLS client certificate file |
| `CLAUDE_CODE_CLIENT_KEY` | mTLS client private key file |
| `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE` | mTLS private key passphrase |

### 3.4 Cloud Providers (Network Tab / Advanced)

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_USE_BEDROCK` | Use AWS Bedrock |
| `CLAUDE_CODE_SKIP_BEDROCK_AUTH` | Skip Bedrock AWS authentication |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock API key |
| `CLAUDE_CODE_USE_VERTEX` | Use Google Vertex AI |
| `CLAUDE_CODE_SKIP_VERTEX_AUTH` | Skip Vertex Google authentication |
| `VERTEX_REGION_*` | Vertex AI per-model region override |
| `CLAUDE_CODE_USE_FOUNDRY` | Use Microsoft Foundry |
| `CLAUDE_CODE_SKIP_FOUNDRY_AUTH` | Skip Foundry Azure authentication |
| `ANTHROPIC_FOUNDRY_API_KEY` | Foundry API key |
| `ANTHROPIC_FOUNDRY_BASE_URL` | Foundry resource URL |
| `ANTHROPIC_FOUNDRY_RESOURCE` | Foundry resource name |

### 3.5 Shell & Bash (Sandbox Tab)

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_SHELL` | Override shell detection |
| `CLAUDE_CODE_SHELL_PREFIX` | Command prefix wrapper |
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | Return to original directory after each command |
| `BASH_DEFAULT_TIMEOUT_MS` | Default bash timeout |
| `BASH_MAX_TIMEOUT_MS` | Maximum timeout the model can set |
| `BASH_MAX_OUTPUT_LENGTH` | Bash output truncation limit |

### 3.6 MCP-related (MCP Servers Tab)

| Variable | Description |
|----------|-------------|
| `MCP_TIMEOUT` | MCP server startup timeout (ms) |
| `MCP_TOOL_TIMEOUT` | MCP tool execution timeout (ms) |
| `MCP_CLIENT_SECRET` | OAuth client secret |
| `MCP_OAUTH_CALLBACK_PORT` | Fixed OAuth redirect port |
| `MAX_MCP_OUTPUT_TOKENS` | Max MCP response tokens (default 25000) |
| `ENABLE_TOOL_SEARCH` | Tool search: `auto`, `auto:N`, `true`, `false` |

### 3.7 Telemetry & Monitoring (not in UI / Environments Tab general list)

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | Enable OpenTelemetry |
| `DISABLE_TELEMETRY` | Disable Statsig telemetry |
| `DISABLE_ERROR_REPORTING` | Disable Sentry error reporting |
| `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` | Disable session quality survey |
| `DISABLE_COST_WARNINGS` | Disable cost warnings |
| `OTEL_METRICS_EXPORTER` | OTel metrics exporter |

### 3.8 Feature Flags (not in UI / Environments Tab general list)

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` | Enable/disable prompt suggestions |
| `CLAUDE_CODE_ENABLE_TASKS` | Use task tracking system |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | Disable auto memory |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | Disable background tasks |
| `DISABLE_AUTOUPDATER` | Disable auto-updater |
| `DISABLE_PROMPT_CACHING` | Globally disable prompt caching |
| `DISABLE_PROMPT_CACHING_HAIKU` | Disable Haiku prompt caching |
| `DISABLE_PROMPT_CACHING_SONNET` | Disable Sonnet prompt caching |
| `DISABLE_PROMPT_CACHING_OPUS` | Disable Opus prompt caching |
| `DISABLE_NON_ESSENTIAL_MODEL_CALLS` | Disable non-essential model calls |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Disable all non-essential traffic |

### 3.9 Files & Storage

| Variable | Description |
|----------|-------------|
| `CLAUDE_CONFIG_DIR` | Custom config/data directory |
| `CLAUDE_CODE_TMPDIR` | Override temp directory |

### 3.10 Other

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_HIDE_ACCOUNT_INFO` | Hide email/org info |
| `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` | Disable terminal title updates |
| `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY` | Auto-exit delay (ms) |
| `CLAUDE_CODE_TASK_LIST_ID` | Shared task list across sessions |
| `CLAUDE_CODE_TEAM_NAME` | Agent team name |
| `CLAUDE_CODE_API_KEY_HELPER_TTL_MS` | Credential refresh interval (ms) |
| `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE` | Auto-compact trigger percentage (1-100) |
| `USE_BUILTIN_RIPGREP` | Use built-in ripgrep (set 0 to use system rg) |
| `IS_DEMO` | Demo mode |

---

## 4. Model System

### 4.1 Model Aliases

| Alias | Behavior |
|-------|----------|
| `default` | Recommended setting, determined by account type (Max/Teams/Pro → Opus 4.7) |
| `sonnet` | Latest Sonnet (currently Sonnet 4.5), everyday coding |
| `opus` | Latest Opus (currently Opus 4.7), complex reasoning |
| `haiku` | Fast and efficient, simple tasks |
| `sonnet[1m]` | Sonnet + 1M context window |
| `opusplan` | Opus for plan mode, Sonnet for execution |

Aliases always point to the latest version. To pin a specific version, use the full model name (e.g. `claude-opus-4-7`).

### 4.2 Model Selection Priority

1. **Within session** — `/model <alias|name>` switch
2. **At startup** — `claude --model <alias|name>`
3. **Environment variable** — `ANTHROPIC_MODEL=<alias|name>`
4. **Settings** — `model` field in `settings.json`

### 4.3 Model Routing Environment Variables

| Variable | Alias overridden |
|----------|-----------------|
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `sonnet` / `default` / `opusplan` (execution phase) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `opus` / `opusplan` (Plan Mode phase) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `haiku` / background functions |
| `CLAUDE_CODE_SUBAGENT_MODEL` | sub-agents |

### 4.4 Effort Level

Adaptive reasoning for Opus 4.6+, dynamically allocates thinking budget:

- `low` — fast and cheap, suitable for simple tasks
- `medium` — balanced
- `high` — deep reasoning, suitable for complex problems (default)

Can be set via settings key `effortLevel`, environment variable `CLAUDE_CODE_EFFORT_LEVEL`, or `/model` slider.

---

## 5. MCP Server Configuration

### 5.1 Storage Location (independent of settings.json)

| Scope | Location | Purpose |
|-------|----------|---------|
| Local | `~/.claude.json` (stored per project path) | personal, current project |
| Project | `.mcp.json` (project root) | team-shared (git committed) |
| User | `~/.claude.json` (global section) | personal, cross-project |
| Managed | system directory `managed-mcp.json` | enterprise-level (exclusive control) |

### 5.2 Server Types

| Type | Transport | Typical use |
|------|-----------|-------------|
| HTTP | Streamable HTTP | remote cloud services (recommended) |
| SSE | Server-Sent Events | remote cloud services (deprecated) |
| stdio | standard I/O | local processes |

### 5.3 .mcp.json Format

```jsonc
{
  "mcpServers": {
    "server-name": {
      "type": "http",                    // or "stdio"
      "url": "https://mcp.example.com/mcp",  // HTTP/SSE
      "command": "/path/to/server",      // stdio
      "args": [],                        // stdio
      "env": {},                         // environment variables
      "headers": {},                     // HTTP headers
      "oauth": {                         // OAuth config
        "clientId": "...",
        "callbackPort": 8080
      }
    }
  }
}
```

Supports environment variable expansion: `${VAR}` and `${VAR:-default}` syntax.

### 5.4 Managed MCP

- `managed-mcp.json` has **exclusive control** once deployed; users cannot add other servers
- Can be combined with `allowedMcpServers` / `deniedMcpServers`
- Restrictions by: `serverName`, `serverCommand` (exact match), `serverUrl` (wildcard)

---

## 6. Memory System

### 6.1 Memory Hierarchy (highest to lowest priority)

| Type | Location | Purpose | Shared scope |
|------|----------|---------|--------------|
| Managed policy | system directory `CLAUDE.md` | enterprise-level instructions | all users |
| User memory | `~/.claude/CLAUDE.md` | personal global preferences | self only |
| User rules | `~/.claude/rules/*.md` | personal modular rules | self only |
| Project memory | `./CLAUDE.md` or `./.claude/CLAUDE.md` | project instructions | team (git) |
| Project rules | `./.claude/rules/*.md` | project modular rules | team (git) |
| Local memory | `./CLAUDE.local.md` | local project preferences | self only (gitignored) |
| Auto memory | `~/.claude/projects/<project>/memory/` | Claude auto-recorded notes | self only |

### 6.2 Modular Rules (.claude/rules/)

Supports `paths` field in YAML frontmatter for path-conditional rules:

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Development Rules
- All API endpoints must include input validation
```

Rules without a `paths` field are loaded unconditionally. Supports glob wildcards and brace expansion.

### 6.3 Auto Memory

Stored under `~/.claude/projects/<project>/memory/`:

```
memory/
├── MEMORY.md          # concise index, first 200 lines loaded per session
├── debugging.md       # debugging session notes
├── api-conventions.md # API design decisions
└── ...
```

Controlled via the `CLAUDE_CODE_DISABLE_AUTO_MEMORY` environment variable.

### 6.4 Import Syntax

CLAUDE.md files support `@path/to/import` syntax to import other files:

```markdown
See @README for project overview.
Individual preferences: @~/.claude/my-project-instructions.md
```

Recursive imports, maximum depth 5 levels. `@` inside code blocks and code spans does not trigger imports.

---

## 7. Tab ↔ Setting Key Mapping

### 7.1 Overview

| Tab | Settings Keys | UI-exposed Env Vars | Special Data Source |
|-----|--------------|---------------------|---------------------|
| **General** | `language`, `cleanupPeriodDays`, `attribution`, `autoUpdatesChannel`, `showTurnDuration`, `spinnerTipsEnabled`, `spinnerVerbs`, `prefersReducedMotion`, `terminalProgressBarEnabled`, `forceLoginMethod` | — | ExtensionConfig: `systemNotifications`, `completionSound` |
| **Models** | `model`, `effortLevel`, `alwaysThinkingEnabled` | `ANTHROPIC_DEFAULT_*_MODEL`, `ANTHROPIC_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, `MAX_THINKING_TOKENS` | ExtensionConfig: `customModels` |
| **Agent** | `agent`, `outputStyle`, `teammateMode`, `respectGitignore`, `plansDirectory`, `fileSuggestion`, `statusLine` | — | — |
| **Permissions** | `permissions.*` (allow/deny/ask/defaultMode/additionalDirectories/disableBypassPermissionsMode) | — | — |
| **Hooks** | `hooks` (14 event types), `disableAllHooks` | — | — |
| **MCP Servers** | `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers` | `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS`, `ENABLE_TOOL_SEARCH` | **Pipeline C**: `~/.claude.json`, `.mcp.json` |
| **Memory & Rules** | — | — | CLAUDE.md file family, `.claude/rules/*.md`, auto memory |
| **Environments** | `env` (excluding keys claimed by other tabs) | general/uncategorized env vars | — |
| **Sandbox** | `sandbox.*` | `BASH_DEFAULT_TIMEOUT_MS`, `BASH_MAX_TIMEOUT_MS`, `CLAUDE_CODE_SHELL`, `BASH_MAX_OUTPUT_LENGTH` | — |
| **Network** | `skipWebFetchPreflight`, `remote` | `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `CLAUDE_CODE_CLIENT_*`, cloud provider vars | — |
| **Profiles** | — | — | ExtensionConfig: `activeProfile` |
| **Slash Commands** | — | — | SDK (read-only) |

### 7.2 Env Partitioning Rules

All environment variables are stored in the same `settings.json` → `env` object. The UI layer splits them by purpose for display:

- Each tab declares the set of env keys it "owns"
- Environments Tab shows all **unclaimed** env keys
- Writes merge into the same `env` object:

```typescript
const currentEnv = settings.value.env || {};
updateSetting('env', { ...currentEnv, [KEY]: newValue }, scope);
```

---

## 8. Extension Config (Pipeline B)

### 8.1 Storage Location

`~/.relay.json` — extension-only config, does not follow CC Profiles.

### 8.2 Field Definitions

| Key | Type | Description | Status |
|-----|------|-------------|--------|
| `activeProfile` | `string \| null` | Current active Profile name | Implemented |
| `customModels` | `string[]` | User-defined model ID list | Pending |
| `systemNotifications` | boolean | System notification toggle | Implemented |
| `completionSound` | boolean | Completion sound | Implemented |

### 8.3 Deprecated / Pending Migration Fields

| Key | Current state | Migration target |
|-----|--------------|-----------------|
| `defaultModel` | ExtensionConfig | → CC Settings `model` (Models Tab) |
| `defaultPermissionMode` | ExtensionConfig | → CC Settings `permissions.defaultMode` (Permissions Tab) |
| `defaultThinkingLevel` | ExtensionConfig | → CC Settings `alwaysThinkingEnabled` + env `MAX_THINKING_TOKENS` |

---

## 9. Current Implementation Status

### 9.1 Tab Implementation Progress

| Tab | Status | Scope-aware | Uses SettingsItem |
|-----|--------|-------------|------------------|
| General | Implemented | Partial (ext config items have no scope) | Partial |
| Models | Stub (read OK, write not implemented) | No | No |
| Agent | Partial (only cleanupPeriodDays) | No | No |
| Permissions | Coming Soon | — | — |
| Hooks | Coming Soon | — | — |
| MCP Servers | Coming Soon | — | — |
| Memory & Rules | Implemented | No | No |
| Environments | Implemented | Yes (uses SettingsItem) | Yes |
| Sandbox | Implemented | No (hardcoded global) | No |
| Network | Implemented | No (hardcoded global) | No |
| Profiles | Implemented | N/A | N/A |
| Slash Commands | Coming Soon | — | — |

### 9.2 SettingsItem Component

A unified scope-aware settings item component. Features:

- `inspect()` reads the current value and its effective scope
- Automatically shows ScopeSelect dropdown (User / Workspace / Local)
- Read-only scopes (managed / cli) show a badge instead of a dropdown
- Passes `value` and `update` callback via slot

**Current usage:** Only General Tab (notification toggle) and Environments Tab use it. Goal is to unify all CC settings items to use it.

---

## 10. Design Principles

### 10.1 Three Rules

1. **Keys that exist in the CC schema** → always go through Pipeline A (`updateSetting`)
2. **Keys not in CC schema, extension-only** → go through Pipeline B (`updateExtensionConfig`)
3. **Each setting has exactly one authoritative source**

### 10.2 Unified Component Pattern

All CC settings items should be wrapped with the `SettingsItem` component:

```vue
<SettingsItem setting-key="model" label="Default Model">
  <template #default="{ value, update }">
    <Dropdown :model-value="value" @update:model-value="update" :options="modelOptions" />
  </template>
</SettingsItem>
```

Automatically gains: scope selection, inspect value reading, profile switch refresh.

### 10.3 Env Partitioning

`env` is a shared object; the UI splits it across tabs by purpose. Each tab only displays and edits the keys it owns, and writes merge into the same `env` object.

### 10.4 Profile Behavior

- Pipeline A (CC Settings): follows Profile switching; different Profiles can have different model, env, permissions, etc.
- Pipeline B (Extension Config): does not follow Profile; `customModels` / `systemNotifications` etc. are globally shared
- Pipeline C (MCP Config): MCP server list is independent of the Profile system

---

## 11. Scope UX Design

### 11.1 Design Decision: Page-level Scope Tab

**Rejected approach:** per-item ScopeSelect (a scope dropdown next to each setting)

- Visual noise: 10+ settings items all with dropdowns
- Cognitive load: must think "which layer to write to" for every change
- Cannot tell at a glance which settings are team-shared in the project

**Adopted approach:** page-level Scope Tab (similar to VS Code's User / Workspace switch)

### 11.2 Layout Structure

```
+----------------------------------------------------------+
|  Settings                                                 |
|                                                           |
|  Profile: [Default v]          <- only affects User scope |
|                                                           |
|  +----------+-------------+---------+                     |
|  |  User    |  Workspace  |  Local  |  <- page-level tab  |
|  +==========+=============+=========+                     |
|  |                                  |                     |
|  |  +-----------+  +-------------+  |                     |
|  |  |  General  |  | Settings    |  |                     |
|  |  |  Models   |  | Content     |  |                     |
|  |  |  Agent    |  |             |  |                     |
|  |  |  ...      |  |             |  |                     |
|  |  +-----------+  +-------------+  |                     |
|  |  Left tabs     Right content     |                     |
|  +----------------------------------+                     |
+----------------------------------------------------------+
```

The Scope Tab sits at the top of the content area, covering all tabs. Switching scope does not change the currently selected tab.

### 11.3 Behavior of the Three Scope Views

#### User view (default)

- **Shows:** `~/.claude/settings.json` (or `settings.{profile}.json`) values
- **Edits:** writes → `updateSetting(key, value, 'global')`
- **Unset items:** shows default value + "(default)" marker
- **Override indicator:** when value is overridden by Workspace/Local, shows "⚠ overridden by Workspace as xxx"

```
  Model           [Opus v]
  Effort Level    [High v]
  Thinking        [enabled]
                  ⚠ overridden by Workspace as "disabled"    <- override indicator
```

#### Workspace view

- **Shows:** `.claude/settings.json` values
- **Edits:** writes → `updateSetting(key, value, 'shared')`
- **Unset items:** shows User-inherited effective value in gray + "(inherited)" marker
- **No workspace:** entire tab disabled, shows info text

```
  Model           [unset]  (inherited: Opus)    <- gray, inherited from User
  Thinking        [disabled]                    <- Workspace layer has value
  permissions     [allow list...]               <- Workspace layer has value
```

#### Local view

- **Shows:** `.claude/settings.local.json` values
- **Edits:** writes → `updateSetting(key, value, 'local')`
- **Unset items:** shows inherited effective value in gray + "(inherited)" marker
- **No workspace:** entire tab disabled, shows info text

### 11.4 Override Indicators

Using the `values` field returned by `inspect(key)` to determine override relationships:

```typescript
// inspect('model') example return value
{
  value: "sonnet",           // final effective value
  effectiveScope: "shared",  // effective at Workspace layer
  values: {
    global: "opus",          // User layer set "opus"
    shared: "sonnet",        // Workspace layer overrides to "sonnet"
    local: undefined,        // Local layer not set
    default: "default"       // default value
  }
}
```

| Current view | Displayed value | State | Action |
|-------------|----------------|-------|--------|
| User | `opus` | ⚠ overridden by Workspace | Edit → `updateSetting('model', x, 'global')` |
| Workspace | `sonnet` | Set | Edit/Reset → `update/resetSetting('model', 'shared')` |
| Local | *(unset)* (effective: sonnet) | Inherited | Click to set → `updateSetting('model', x, 'local')` |

### 11.5 Reset Functionality

A `[Reset]` button appears next to each set value, calling `resetSetting(key, scope)` to delete the current layer's value and fall back to inheritance.

### 11.6 Profile and Scope Interaction

```
Profile switching only affects User scope:
  ├── Profile "default"  -> ~/.claude/settings.json
  ├── Profile "aws"      -> ~/.claude/settings.aws.json
  └── Profile "vertex"   -> ~/.claude/settings.vertex.json

Workspace and Local scopes are not affected by Profile
```

Therefore the Profile selector is only meaningful in the User view. It can be hidden or grayed out in Workspace / Local views.

### 11.7 Degraded State Without Workspace

When no workspace is open:
- Workspace and Local tabs are disabled (not clickable)
- Shows tooltip: "Open a workspace to use Workspace and Local settings"
- Determined by adding `hasWorkspace: boolean` field to `GetSettingsResponse`

### 11.8 Implementation Architecture

```
SettingsPage.vue
  |
  +-- activeScope = ref<'global' | 'shared' | 'local'>('global')
  +-- provide('settingsScope', activeScope)
  |
  +-- <SettingsScopeTab v-model="activeScope" />     <- page-level scope switch
  |
  +-- <SettingsTab*>
        +-- <SettingsItem setting-key="model">
              |
              +-- inject('settingsScope') -> get current scope
              +-- inspect(key).values[scope] -> current layer value
              +-- inspect(key).value -> effective value (for inherited display)
              +-- updateSetting(key, val, scope) -> write to current layer
              +-- resetSetting(key, scope) -> reset current layer
```

### 11.9 SettingsItem Slot Props After Refactor

```typescript
interface SettingsItemSlotProps {
  value: any;              // current scope layer value (may be undefined)
  effectiveValue: any;     // final effective value (across all scopes)
  inherited: boolean;      // whether in inherited state (current scope layer not set)
  overriddenBy: string | null;  // which layer overrides this (useful only in User view)
  update: (val: any) => void;   // write to current scope
  reset: () => void;            // reset current scope
}
```
