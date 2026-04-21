# Claude Service Module

Dependency-injection (DI) based core services for the Claude Agent, using a modular architecture.

## Directory Structure

```
claude/
├── transport/                      # Transport layer module
│   ├── index.ts                   # unified exports
│   ├── AsyncStream.ts             # stream abstraction (generic)
│   ├── BaseTransport.ts           # transport layer abstract base class
│   └── VSCodeTransport.ts         # VSCode WebView implementation
│
├── handlers/                       # Request handlers
│   ├── types.ts                   # handler type definitions
│   ├── sessions.ts                # session handling
│   ├── auth.ts                    # authentication handling
│   └── ...                        # other handlers
│
├── ClaudeAgentService.ts          # core orchestration service
├── ClaudeSdkService.ts            # thin SDK wrapper
└── ClaudeSessionService.ts        # session history service
```

## Architecture Layers

```
+--------------------------------------------------+
|              ClaudeAgentService                  |  Core orchestration
|  (orchestration, routing, session mgmt, RPC)     |
+------------------+---------------+---------------+
                   |               |
         +---------v------+  +-----v--------------+
         |  ITransport    |  |  ClaudeSdkService  |    Service layer
         |  (transport    |  |  (SDK wrapper)     |
         |   interface)   |  +-----+--------------+
         +---------+------+        |
                   |               |
         +---------v------+  +-----v--------------+
         | BaseTransport  |  |  AsyncStream       |    Infrastructure
         | (generic       |  |  (stream           |
         |  transport     |  |   abstraction)     |
         |  logic)        |  +--------------------+
         +---------+------+
                   |
         +---------v------+
         |VSCodeTransport |                            Platform impl.
         |(VSCode WebView)|
         +----------------+
```

## Core Components

### Transport Layer (transport/)

**BaseTransport** — abstract base class
- Provides message buffering, error handling, and listener management
- Defines the ITransport interface
- Subclasses only need to implement `doSend()` and `doClose()`

**VSCodeTransport** — VSCode implementation
- Inherits from BaseTransport
- Wraps VSCode WebView communication
- Automatically manages resources (Disposable)

**AsyncStream** — stream abstraction
- Producer-consumer pattern
- Backpressure control, error propagation
- Shared by Agent, SDK, and Transport

### Core Services

**ClaudeAgentService**
- Manages multiple Claude sessions (channels)
- Routes requests to handlers
- RPC request-response management
- Depends on ITransport interface (decoupled)

**ClaudeSdkService**
- Wraps the Claude Agent SDK
- Provides `query()` and `interrupt()` methods
- Configuration management (Options, Hooks, environment variables)

**ClaudeSessionService**
- Loads and manages session history
- Provides `listSessions()` and `getSession()`
- Internal caching for performance

### Handlers

Unified signature:
```typescript
async function handleXxx(
    request: TRequest,
    context: HandlerContext,
    signal?: AbortSignal
): Promise<TResponse>
```

HandlerContext only contains service interfaces; direct use of VS Code native APIs is prohibited.

## Usage Examples

### Initialization

```typescript
// 1. Get service instances (via DI container)
const agentService = instantiationService.get(IClaudeAgentService);
const logService = instantiationService.get(ILogService);

// 2. Create Transport
const transport = new VSCodeTransport(webview, logService);

// 3. Initialize Agent
agentService.init(transport);
```

### Start a Session

```typescript
await agentService.launchClaude(
    'channel-1',
    null,                    // resume
    '/path/to/workspace',
    'claude-sonnet-4-5',
    'default'                // permissionMode
);
```

### Extending to Other Platforms

```typescript
// NestJS WebSocket Transport
class NestJSTransport extends BaseTransport {
    constructor(
        private gateway: WebSocketGateway,
        logService: ILogService
    ) {
        super(logService);
        gateway.onMessage((msg) => this.handleIncomingMessage(msg));
    }

    protected doSend(message: any): void {
        this.gateway.emit('message', message);
    }

    protected doClose(): void {
        this.gateway.close();
    }
}

// Usage is identical
const transport = new NestJSTransport(gateway, logService);
agentService.init(transport);
```

## Design Principles

1. **Dependency injection**: all services managed through the DI container
2. **Separation of concerns**: each module has a clear responsibility boundary
3. **Interface segregation**: Transport, Handler, etc. are all defined through interfaces
4. **Open/closed**: easy to extend (new Handler, new Transport), hard to modify
5. **Platform decoupling**: core logic does not depend on any specific platform API

## Extension Guide

### Adding a New Handler

1. Create a new file in `handlers/`
2. Implement a handler function with the unified signature
3. Add routing in `ClaudeAgentService.handleRequest()`

### Adding a New Transport

1. Extend `BaseTransport`
2. Implement `doSend()` and `doClose()`
3. Optionally override error handling methods

### Adding a New Service

1. Define the service interface (using createDecorator)
2. Implement the service class
3. Register in serviceRegistry
4. Inject via constructor

## Testing

The modular transport design makes testing easier:

```typescript
// Mock Transport
class MockTransport extends BaseTransport {
    messages: any[] = [];

    protected doSend(message: any): void {
        this.messages.push(message);
    }

    protected doClose(): void {
        this.messages = [];
    }

    // Simulate receiving a message
    simulateMessage(message: any): void {
        this.handleIncomingMessage(message);
    }
}

// Test using Mock Transport
const mockTransport = new MockTransport(logService);
agentService.init(mockTransport);

// Verify sent messages
expect(mockTransport.messages).toContainEqual({
    type: 'io_message',
    channelId: 'test',
    // ...
});
```

## Reference Documentation

- [RefactorFunctions.md](../../../RefactorFunctions.md) - detailed refactoring plan
- [REFACTOR_SUMMARY.md](../../../REFACTOR_SUMMARY.md) - refactoring summary and architecture analysis
