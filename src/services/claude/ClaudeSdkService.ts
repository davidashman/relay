/**
 * ClaudeSdkService - Claude Agent SDK
 *
 * 1.  @anthropic-ai/claude-agent-sdk  query()
 * 2.  SDK Options
 * 3.
 * 4.  interrupt()
 *
 * - ILogService:
 * - IConfigurationService:
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { IConfigurationService } from '../configurationService';
import { IFileSystemService } from '../fileSystemService';
import { AsyncStream } from './transport';

// SDK
import type {
    Options,
    Query,
    CanUseTool,
    PermissionMode,
    SDKUserMessage,
    HookCallbackMatcher,
    ThinkingConfig,
} from '@anthropic-ai/claude-agent-sdk';

export const IClaudeSdkService = createDecorator<IClaudeSdkService>('claudeSdkService');

/**
 * SDK
 */
/**
 * stderr
 */
export interface LLMRequestError {
    statusCode: string;    // HTTP  (e.g. 401, 503)
    message: string;       //
    type: string;          //  (e.g. authentication_error, new_api_error)
    raw: string;           //  stderr
}

export interface SdkQueryParams {
    inputStream: AsyncStream<SDKUserMessage>;
    resume: string | null;
    canUseTool: CanUseTool;
    model: string | null;  // ←  null
    cwd: string;
    permissionMode: PermissionMode | string;  // ←
    thinking?: ThinkingConfig;
    effortLevel?: string | null; // ← Opus 4.6+ adaptive reasoning effort (low | medium | high)
    /**  stderr  */
    onStderrError?: (error: LLMRequestError) => void;
}

export interface SdkProbeParams {
    capabilities: string[];
    cwd: string;
    timeoutMs?: number;
}

export interface SdkProbeResult {
    data: Record<string, any>;
    errors?: Record<string, string>;
}

/**
 * SDK
 */
export interface IClaudeSdkService {
    readonly _serviceBrand: undefined;

    /**
     *  Claude SDK
     */
    query(params: SdkQueryParams): Promise<Query>;

    /**
     *  SDK
     */
    probe(params: SdkProbeParams): Promise<SdkProbeResult>;

    /**
     */
    interrupt(query: Query): Promise<void>;
}

const VS_CODE_APPEND_PROMPT = `
  # VSCode Extension Context

  You are running inside a VSCode native extension environment.

  ## Code References in Text
  IMPORTANT: When referencing files or code locations, use markdown link syntax to make them clickable:
  - For files: [filename.ts](src/filename.ts)
  - For specific lines: [filename.ts:42](src/filename.ts#L42)
  - For a range of lines: [filename.ts:42-51](src/filename.ts#L42-L51)
  - For folders: [src/utils/](src/utils/)
  Unless explicitly asked for by the user, DO NOT USE backtickets \` or HTML tags like code for file references - always use markdown [text](link) format.
  The URL links should be relative paths from the root of  the user's workspace.

  ## User Selection Context
  The user's IDE selection (if any) is included in the conversation context and marked with ide_selection tags. This represents code or text the user has highlighted in their editor and may or may not be relevant to their request.`;

const SDK_PROBE_CAPABILITIES: Record<string, (query: Query) => Promise<any>> = {
    supportedCommands: (query) => query.supportedCommands?.(),
    supportedModels: (query) => query.supportedModels?.(),
    mcpServerStatus: (query) => query.mcpServerStatus?.(),
    accountInfo: (query) => query.accountInfo?.()
};

/**
 * ClaudeSdkService
 */
export class ClaudeSdkService implements IClaudeSdkService {
    readonly _serviceBrand: undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        @ILogService private readonly logService: ILogService,
        @IConfigurationService private readonly configService: IConfigurationService,
        @IFileSystemService private readonly fileSystemService: IFileSystemService
    ) {
        this.logService.info('[ClaudeSdkService] ');
    }

    /**
     *  Claude SDK
     */
    async query(params: SdkQueryParams): Promise<Query> {
        const { inputStream, resume, canUseTool, model, cwd, permissionMode, thinking, effortLevel, onStderrError } = params;

        this.logService.info('========================================');
        this.logService.info('ClaudeSdkService.query() ');
        this.logService.info('========================================');
        this.logService.info(`📋 :`);
        this.logService.info(`  - model: ${model}`);
        this.logService.info(`  - cwd: ${cwd}`);
        this.logService.info(`  - permissionMode: ${permissionMode}`);
        this.logService.info(`  - resume: ${resume}`);
        this.logService.info(`  - thinking: ${thinking ? JSON.stringify(thinking) : 'undefined'}`);
        this.logService.info(`  - effortLevel: ${effortLevel ?? 'undefined'}`);

        const modelParam = model === null ? "default" : model;
        const permissionModeParam = permissionMode as PermissionMode;
        const cwdParam = cwd;

        this.logService.info(`🔄 :`);
        this.logService.info(`  - modelParam: ${modelParam}`);
        this.logService.info(`  - permissionModeParam: ${permissionModeParam}`);
        this.logService.info(`  - cwdParam: ${cwdParam}`);

        //  CLI  TypeScript
        const cliPath = await this.getClaudeExecutablePath();

        const env = await this.getMergedEnvironmentVariables(modelParam);

        // Resolve Claude config dir (honours relay.configurationDirectory > CLAUDE_CONFIG_DIR > default)
        const relayDir = env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
        const relayPath = path.join(relayDir, 'relay.json');

        // Inject effort level for Opus 4.6+ adaptive reasoning. CLI reads
        // CLAUDE_CODE_EFFORT_LEVEL at spawn time. If the user already set this
        // env var explicitly via settings/env config, respect that.
        if (effortLevel && !env.CLAUDE_CODE_EFFORT_LEVEL) {
            env.CLAUDE_CODE_EFFORT_LEVEL = effortLevel;
        }

        this.logService.info(`🌍  (env):`);
        if (env && Object.keys(env).length > 0) {
            for (const [key, value] of Object.entries(env)) {
                this.logService.info(`  - ${key}: ${value}`);
            }
        } else {
            this.logService.info(`  (empty)`);
        }

        //  CLI
        this.logService.info(`📂 CLI :`);
        this.logService.info(`  - CLI Path: ${cliPath}`);
        this.logService.info(`  - Settings Path: ${relayPath}`);

        //  CLI
        if (!(await this.fileSystemService.pathExists(cliPath))) {
          this.logService.error(`❌ Claude CLI not found at: ${cliPath}`);
          throw new Error(`Claude CLI not found at: ${cliPath}`);
        }
        this.logService.info(`  ✓ CLI `);

        try {
          const stats = await this.fileSystemService.stat(vscode.Uri.file(cliPath));
          const isExec = await this.fileSystemService.isExecutable(cliPath);
          this.logService.info(`  - File size: ${stats.size} bytes`);
          this.logService.info(`  - Is executable: ${isExec}`);
        } catch (e) {
          this.logService.warn(`  ⚠ Could not check file stats: ${e}`);
        }

        //  SDK Options
        const options: Options = {
            cwd: cwdParam,
            resume: resume || undefined,
            model: modelParam,
            permissionMode: permissionModeParam,
            thinking,

            // CanUseTool
            canUseTool,

            //  -  SDK
            stderr: (data: string) => {
                const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
                const lines = data.trim().split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;

                    const lowerLine = line.toLowerCase();
                    let level = 'INFO';

                    if (lowerLine.includes('error') || lowerLine.includes('failed') || lowerLine.includes('exception')) {
                        level = 'ERROR';
                    } else if (lowerLine.includes('warn') || lowerLine.includes('warning')) {
                        level = 'WARN';
                    } else if (lowerLine.includes('exit') || lowerLine.includes('terminated')) {
                        level = 'EXIT';
                    }

                    this.logService.info(`[${timestamp}] [SDK ${level}] ${line}`);

                    // "Error streaming, falling back to non-streaming mode: {statusCode} {json}"
                    if (onStderrError) {
                        const streamingErrorMatch = line.match(
                            /Error streaming, falling back to non-streaming mode:\s*(\d+)\s*(.*)/
                        );
                        if (streamingErrorMatch) {
                            const statusCode = streamingErrorMatch[1];
                            const rest = streamingErrorMatch[2];

                            let message = `HTTP ${statusCode}`;
                            let errorType = 'unknown';
                            try {
                                const jsonMatch = rest.match(/(\{[\s\S]*\})/);
                                if (jsonMatch) {
                                    const parsed = JSON.parse(jsonMatch[1]);
                                    const err = parsed.error || parsed;
                                    message = err.message || err.msg || message;
                                    errorType = err.type || err.code || errorType;
                                }
                            } catch { /* non-JSON tail, use statusCode as message */ }

                            onStderrError({ statusCode, message, type: errorType, raw: line });
                        }
                    }
                }
            },

            env,

            systemPrompt: {
                type: 'preset',
                preset: 'claude_code',
                append: VS_CODE_APPEND_PROMPT
            },

            // Hooks
            hooks: {
                // PreToolUse:
                PreToolUse: [{
                    matcher: "Edit|Write|MultiEdit",
                    hooks: [async (input, toolUseID, options) => {
                        if ('tool_name' in input) {
                            this.logService.info(`[Hook] PreToolUse: ${input.tool_name}`);
                        }
                        return { continue: true };
                    }]
                }] as HookCallbackMatcher[],
                // PostToolUse:
                PostToolUse: [{
                    matcher: "Edit|Write|MultiEdit",
                    hooks: [async (input, toolUseID, options) => {
                        if ('tool_name' in input) {
                            this.logService.info(`[Hook] PostToolUse: ${input.tool_name}`);
                        }
                        return { continue: true };
                    }]
                }] as HookCallbackMatcher[]
            },

            // CLI
            pathToClaudeCodeExecutable: cliPath,

            // --settings  relay.jsonProfile  ConfigurationService
            // CLI
            extraArgs: {
              'debug': null,
              'debug-to-stderr': null,
              // 'enable-auth-status': null,
              'settings': relayPath,
            } as Record<string, string | null>,

            //  ( CLAUDE.md  settings.json )
            // 'user': ~/.claude/settings.json, ~/.claude/CLAUDE.md
            // 'project': .claude/settings.json, .claude/CLAUDE.md
            // 'local': .claude/settings.local.json, CLAUDE.local.md
            // : relay.json  extraArgs.settings  flagSettings
            settingSources: ['user', 'project', 'local'],

            includePartialMessages: true
        };

        //  SDK
        this.logService.info('');
        this.logService.info('🚀  Claude Agent SDK');
        this.logService.info('----------------------------------------');

        process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-vscode';
        this.logService.info(`🔧 :`);
        this.logService.info(`  - CLAUDE_CODE_ENTRYPOINT: ${process.env.CLAUDE_CODE_ENTRYPOINT}`);
        const customEnvVars = await this.configService.getEnvironmentVariables();
        for (const [key, value] of Object.entries(customEnvVars)) {
            this.logService.info(`  - ${key}: ${value}`);
        }

        this.logService.info('');
        this.logService.info('📦  SDK...');

        try {
            //  SDK query()
            const { query } = await import('@anthropic-ai/claude-agent-sdk');

            this.logService.info(`  - Options: [ ${Object.keys(options).join(', ')}]`);

            const result = query({ prompt: inputStream, options });
            return result;
        } catch (error) {
            this.logService.error('');
            this.logService.error('❌❌❌ SDK  ❌❌❌');
            this.logService.error(`Error: ${error}`);
            if (error instanceof Error) {
                this.logService.error(`Message: ${error.message}`);
                this.logService.error(`Stack: ${error.stack}`);
            }
            this.logService.error('========================================');
            throw error;
        }
    }

    /**
     *  SDK
     */
    async probe(params: SdkProbeParams): Promise<SdkProbeResult> {
        const capabilities = Array.from(new Set(params.capabilities ?? [])).filter(Boolean);
        if (capabilities.length === 0) {
            return { data: {} };
        }

        const timeoutMs = Math.max(1000, params.timeoutMs ?? 10000);
        const data: Record<string, any> = {};
        const errors: Record<string, string> = {};

        let query: Query | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        try {
            await Promise.race([
                (async () => {
                    query = await this.queryLite(params.cwd);

                    for (const capability of capabilities) {
                        const handler = SDK_PROBE_CAPABILITIES[capability];
                        if (!handler) {
                            errors[capability] = 'Unsupported capability';
                            continue;
                        }

                        try {
                            data[capability] = await handler(query);
                        } catch (error) {
                            errors[capability] = error instanceof Error ? error.message : String(error);
                        }
                    }
                })(),
                new Promise<void>((_, reject) => {
                    timeoutId = setTimeout(() => {
                        reject(new Error('SDK probe timed out'));
                    }, timeoutMs);
                })
            ]);
        } catch (error) {
            if (query) {
                try {
                    await this.interrupt(query);
                } catch {
                }
            }
            throw error;
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            if (query?.return) {
                try {
                    await query.return();
                } catch {
                }
            }
        }

        // this.logService.info(`[Probe] : ${JSON.stringify(data, null, 2)}`);

        return {
            data,
            errors: Object.keys(errors).length ? errors : undefined
        };
    }

    /**
     *  SDK  probe
     *  hooks
     */
    private async queryLite(cwd: string): Promise<Query> {
        const inputStream = new AsyncStream<SDKUserMessage>();

        // probe
        inputStream.done();

        const cliPath = await this.getClaudeExecutablePath();

        const options: Options = {
            cwd,
            model: 'default',
            permissionMode: 'default' as PermissionMode,
            maxThinkingTokens: 0,

            canUseTool: async () => ({
                behavior: 'deny' as const,
                message: 'SDK probe only'
            }),

            settingSources: [],

            //  stderr
            stderr: () => {},

            // CLI
            pathToClaudeCodeExecutable: cliPath,

            //  debug
            extraArgs: {},

            //  partial messages
            includePartialMessages: false,

            //  hooks
            hooks: {}
        };

        const { query } = await import('@anthropic-ai/claude-agent-sdk');
        return query({ prompt: inputStream, options });
    }

    /**
     */
    async interrupt(query: Query): Promise<void> {
        try {
            this.logService.info('🛑  Claude SDK ');
            await query.interrupt();
            this.logService.info('✓ ');
        } catch (error) {
            this.logService.error(`❌ : ${error}`);
            throw error;
        }
    }

    /**
     *  (process.env + custom)
     */
    private async getMergedEnvironmentVariables(model?: string): Promise<Record<string, string>> {
        const customVars = await this.configService.getEnvironmentVariables();
        const configDir = await this.configService.getConfigurationDirectory();

        //  process.env ( undefined)
        const env: Record<string, string> = {
          // CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL: '1'
          // ANTHROPIC_BASE_URL: 'https://anyrouter.top',
          // ANTHROPIC_AUTH_TOKEN: 'sk-PNPwKAii2iEHlPxERYW8zt4xMH60O9iHVFJRbg7z9rnur8HG',
        };
        Object.entries(process.env).forEach(([key, value]) => {
            if (value !== undefined) {
                env[key] = value;
            }
        });

        // If the user explicitly configured a custom configuration directory, inject
        // it as CLAUDE_CONFIG_DIR so the CLI uses it. This wins over any shell-inherited
        // value because the explicit setting should take precedence.
        this.logService.info(`[ClaudeSdkService] configurationDirectory setting resolved to: ${configDir ?? '(not set)'}`);
        if (configDir) {
            env.CLAUDE_CONFIG_DIR = configDir;
            this.logService.info(`[ClaudeSdkService] CLAUDE_CONFIG_DIR overridden to: ${configDir}`);
        } else {
            this.logService.info(`[ClaudeSdkService] CLAUDE_CONFIG_DIR not overridden (inheriting: ${env.CLAUDE_CONFIG_DIR ?? '(unset)'})`);
        }

      const merged = { ...env, ...customVars };

      // The Anthropic API only enables 1M context when the request includes the
      // context-1m-2025-08-07 beta header. The CLI sends it automatically only
      // for models with "[1m]" in their name; for Sonnet 4.6 and Opus 4.x we
      // inject it here via ANTHROPIC_BETAS so the CLI picks it up. We append
      // rather than overwrite so any user-configured betas are preserved.
      if (model && this.needs1MBeta(model)) {
          const existing = merged.ANTHROPIC_BETAS ?? '';
          const betas = new Set(existing.split(',').map(b => b.trim()).filter(Boolean));
          betas.add('context-1m-2025-08-07');
          merged.ANTHROPIC_BETAS = [...betas].join(',');
          this.logService.info(`[ClaudeSdkService] Injected context-1m-2025-08-07 beta for model: ${model}`);
      }

      return merged;
    }

    private needs1MBeta(model: string): boolean {
        const m = model.toLowerCase();
        return m.includes('sonnet-4-6') || m.includes('opus-4-6') || m.includes('opus-4-7');
    }

    /**
     *  Claude CLI
     */
    private async getClaudeExecutablePath(): Promise<string> {
        const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
        const arch = process.arch;

        const nativePath = this.context.asAbsolutePath(
            `resources/native-binaries/${process.platform}-${arch}/${binaryName}`
        );

        if (await this.fileSystemService.pathExists(nativePath)) {
            return nativePath;
        }

        return this.context.asAbsolutePath('resources/claude-code/cli.js');
    }
}
