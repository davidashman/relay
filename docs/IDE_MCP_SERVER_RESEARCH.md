# Claude Code IDE MCP Server Research

## Executive Summary

The Claude Code IDE MCP server is a **built-in local HTTP MCP server** that VS Code extension instances run to enable bidirectional IDE integration. The CLI connects to it automatically via a per-channel configuration file to access IDE-specific capabilities like permission prompts, plan review modals, and Jupyter notebook execution.

---

## 1. What Tools/Resources Does the IDE MCP Server Expose?

### User-Facing Tools (Visible to Claude)
The server exposes **2 tools** that are visible to the Claude model:

1. **`mcp__ide__getDiagnostics`** (read-only)
   - Returns language-server diagnostics (errors and warnings from VS Code's Problems panel)
   - Can be optionally scoped to a single file
   - Use case: Claude can check for compile errors or linting issues in your code

2. **`mcp__ide__executeCode`** (write)
   - Runs Python code in the active Jupyter notebook's kernel
   - Always requires user confirmation via Quick Pick dialog
   - Cannot run silently; user must click "Execute" or "Cancel"
   - Refuses to run if:
     - No active notebook is open
     - Jupyter extension (`ms-toolsai.jupyter`) isn't installed
     - Kernel is not Python

### Internal Tools (Filtered Before Reaching Claude)
The server hosts a dozen additional tools for internal RPC between CLI and extension. These are **not visible to the Claude model** and are filtered out before the tool list reaches Claude. They include:

- `open_file` — Opens files in VS Code editor
- `show_diff` — Displays file diffs in VS Code's native diff viewer
- `get_selection` — Reads the currently selected text in the editor
- `save_file` — Persists file changes
- And others for UI management, permission prompts, and plan review

---

## 2. Protocol Documentation

### MCP Protocol Version
- **Protocol:** MCP (Model Context Protocol)
- **Version:** `2024-11-05`
- **Transport:** Streamable HTTP (not stdio)
- **Stateless:** All methods respond synchronously; no session state is maintained

### HTTP Endpoint Structure
```
POST http://127.0.0.1:{random_port}/mcp/{channelId}
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": <request_id>,
  "method": "<method_name>",
  "params": { ... }
}
```

### Supported MCP Methods
1. **`initialize`**
   - Request: Empty params
   - Response: Protocol version, server capabilities, and server info
   - Example response:
     ```json
     {
       "jsonrpc": "2.0",
       "id": <id>,
       "result": {
         "protocolVersion": "2024-11-05",
         "capabilities": { "tools": {} },
         "serverInfo": { "name": "relay-permission", "version": "1.0.0" }
       }
     }
     ```

2. **`tools/list`**
   - Request: Empty params
   - Response: Array of tool definitions (as seen above: `mcp__ide__getDiagnostics` and `mcp__ide__executeCode`)
   - The server internally hosts more tools, but filters the list before returning

3. **`tools/call`**
   - Request: Tool name and arguments
   - Response: Tool result or error
   - **Response format:**
     ```json
     {
       "jsonrpc": "2.0",
       "id": <id>,
       "result": {
         "content": [{ "type": "text", "text": "<result_json>" }],
         "isError": false
       }
     }
     ```

### Error Handling
- HTTP 401: Unauthorized (unknown channelId)
- HTTP 400: Bad Request (malformed JSON)
- HTTP 405: Method Not Allowed (GET requests)
- HTTP 500: Internal Server Error (exception during dispatch)
- JSON-RPC errors use code `-32601` for "Method not found" and "Unknown tool"

---

## 3. Discovery & Connection Mechanism

### Per-Channel Configuration File
The IDE extension writes a **temporary MCP config JSON file** for each channel:

**File location:** `{temp_dir}/relay-mcp-{channelId}.json`
- On macOS: `/var/folders/.../T/relay-mcp-{channelId}.json` or similar
- On Linux/Windows: Uses `os.tmpdir()` equivalent

**File format:**
```json
{
  "mcpServers": {
    "relay": {
      "type": "http",
      "url": "http://127.0.0.1:{port}/mcp/{channelId}"
    }
  }
}
```

### How the CLI Discovers the Server

The CLI **does not auto-discover**. Instead:

1. **Extension activates:** Creates `RelayMcpServer` HTTP server on `127.0.0.1:0` (OS picks a random free port)
2. **Channel created:** CLI requests MCP config via extension API
3. **Extension writes config file:** Calls `writeMcpConfig(channelId)` which:
   - Generates a random `channelId` (via `Math.random().toString(36)`)
   - Writes the config to a temp file with the channel ID embedded in the URL
   - Returns the config file path to the CLI
4. **CLI reads the config:** Loads the file and connects via the URL
5. **CLI connects to MCP server:** Posts JSON-RPC messages to the HTTP endpoint
6. **Authentication:** The `channelId` is embedded directly in the URL path; no separate auth header

### Authentication Model

- **Security:** Binding to `127.0.0.1` limits exposure to the local machine only
- **Per-channel token:** Each channel gets a random `channelId`; it's valid only for that PTY's lifetime
- **No Authorization header:** Avoids CLI header-forwarding limitations
- **File permissions (extension):** Lock file under `~/.claude/ide/` with `0600` permissions in a `0700` directory, so only the user running VS Code can read it

### Environment Variables / CLI Flags

The CLI connects via the config file, so no explicit environment variables or flags are needed. The extension passes the config file path to the Claude SDK, which handles MCP server connection internally.

---

## 4. Known Implementations & Specs

### Official Implementation: Relay (VS Code Extension)

**File:** `src/services/claude/RelayMcpServer.ts` (in the Relay repository)

**Key features:**
- HTTP server listening on `127.0.0.1:0`
- Stateless request/response model
- Holds `tools/call` responses open until webview modal approves/denies
- Supports:
  - `permission_prompt` tool (shown in webview modal)
  - `ask_user_question` tool (AskUserQuestion prompt)
  - `exit_plan_mode` tool (plan-review modal)
  - `notify_turn_done` tool (signals turn completion)
  - Plus internal tools for diff viewing, file selection, etc.

**How to use it:**
```typescript
const server = new RelayMcpServer(
  async (channelId, toolName, inputs) => {
    // Handle permission request; return { behavior: 'allow' | 'deny', message? }
  },
  async (channelId, inputs) => {
    // Handle question prompt; return { updatedInput: { ... } }
  },
  (channelId) => {
    // Called when turn is done
  }
);

await server.start();
const configPath = await server.writeMcpConfig(channelId);
// Pass configPath to Claude SDK
```

### Third-Party Implementations

Several community projects replicate IDE MCP server functionality:

1. **[malvex/mcp-server-vscode](https://github.com/malvex/mcp-server-vscode)**
   - Gives Claude direct access to VS Code's code navigation, error checking, and debugging tools
   - Exposes diff viewer, selection reading, file operations via stdio

2. **[steipete/claude-code-mcp](https://github.com/steipete/claude-code-mcp)**
   - MCP server wrapping Claude Code in one-shot mode
   - Bypasses permissions automatically

3. **[xihuai18/claude-code-mcp](https://github.com/xihuai18/claude-code-mcp)**
   - MCP server wrapping Claude Agent SDK as tools
   - Designed for local use

4. **[KunihiroS/claude-code-mcp](https://github.com/KunihiroS/claude-code-mcp)**
   - Node.js + MCP SDK, receives JSON via stdio
   - Full Claude Code capabilities exposed as MCP tools

### JetBrains IDE MCP Server

The JetBrains IDE (IntelliJ IDEA, PyCharm, etc.) also runs a built-in MCP server when the Claude Code AI Assistant plugin is active, following a similar pattern to the VS Code extension.

---

## 5. Replicability in a Custom MCP Server

### Yes, This Is Replicable

You can build a custom MCP server that exposes IDE-like capabilities. Here's what you'd need:

#### Minimal Implementation
```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "my-ide-mcp",
  version: "1.0.0",
});

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_file_content",
      description: "Read a file from the workspace",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
        },
        required: ["path"],
      },
    },
    {
      name: "show_diff",
      description: "Show a diff in the IDE",
      inputSchema: {
        type: "object",
        properties: {
          original: { type: "string" },
          modified: { type: "string" },
          filePath: { type: "string" },
        },
        required: ["original", "modified", "filePath"],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_file_content") {
    // Implement file reading logic
  }
  if (request.params.name === "show_diff") {
    // Implement diff display logic (e.g., via IDE API or HTTP callback)
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

#### Key Considerations

1. **Transport choice:**
   - Use **stdio** for a local IDE plugin (like VS Code extension or JetBrains plugin)
   - Use **HTTP** for remote servers or when stdio isn't suitable

2. **Authentication:**
   - For stdio: Inherit parent process authentication (the IDE)
   - For HTTP: Use token-in-URL (like Relay) or Authorization headers

3. **Tool design:**
   - Keep user-facing tools small (2–3 visible tools)
   - Hide internal RPC tools via tool filtering
   - Ensure tools are stateless or handle state explicitly

4. **IDE integration:**
   - Register MCP server with `claude mcp add`
   - Or use extension/plugin mechanism to expose via environment variable or config file

#### Example: Custom VS Code Extension MCP Server

```typescript
// In your VS Code extension
import { RelayMcpServer } from './mcp-server';

const mcpServer = new RelayMcpServer(...);
await mcpServer.start();

// When creating a terminal/session for Claude:
const configPath = await mcpServer.writeMcpConfig(sessionId);
// Pass to Claude CLI via environment variable or CLI argument
```

---

## 6. Summary Table

| Aspect | Details |
|--------|---------|
| **Protocol** | MCP 2024-11-05, Streamable HTTP |
| **Transport** | HTTP (POST to `http://127.0.0.1:{port}/mcp/{channelId}`) |
| **User-facing tools** | 2 (`mcp__ide__getDiagnostics`, `mcp__ide__executeCode`) |
| **Internal tools** | ~12 (filtered before reaching Claude) |
| **Authentication** | Channel ID embedded in URL path |
| **Discovery** | Via temp JSON config file written by extension |
| **Port binding** | `127.0.0.1` + random high port (no remote access) |
| **Per-channel lifetime** | Config file lives as long as channel/PTY exists |
| **Official implementation** | `RelayMcpServer` in VS Code extension |
| **Replicable** | Yes, via custom MCP server (stdio or HTTP) |

---

## Resources & References

- [Claude Code VS Code integration docs](https://code.claude.com/docs/en/vs-code) — Built-in IDE MCP server section
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) — General MCP setup and configuration
- [Model Context Protocol spec](https://modelcontextprotocol.io/introduction) — Protocol reference
- [Claude Agent SDK docs](https://platform.claude.com/docs/en/agent-sdk/mcp) — SDK-level MCP integration
- [Relay codebase](https://github.com/anthropics/relay) — `RelayMcpServer.ts` implementation reference

