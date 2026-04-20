/**
 * ClaudeSessionService - 历史会话加载和管理
 *
 * 职责：
 * 1. 从 ~/.claude/projects/ 目录加载会话历史
 * 2. 解析 .jsonl 文件（每行一个 JSON 对象）
 * 3. 组织会话消息和生成摘要
 * 4. 支持会话列表查询和消息检索
 *
 * 依赖：
 * - ILogService: 日志服务
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { IConfigurationService } from '../configurationService';

export const IClaudeSessionService = createDecorator<IClaudeSessionService>('claudeSessionService');

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 会话消息类型
 */
interface SessionMessage {
    uuid: string;
    sessionId: string;
    parentUuid?: string;
    timestamp: string;
    type: "user" | "assistant" | "attachment" | "system" | "summary";
    message?: any;
    isMeta?: boolean;
    isSidechain?: boolean;
    leafUuid?: string;
    summary?: string;
    toolUseResult?: any;
    gitBranch?: string;
    cwd?: string;

}

/**
 * 会话信息
 */
export interface SessionInfo {
    id: string;
    lastModified: number;
    messageCount: number;
    summary: string;
    isSidechain?: boolean;
    worktree?: string;
    isCurrentWorkspace: boolean;
}

/**
 * 会话服务接口
 */
export interface IClaudeSessionService {
    readonly _serviceBrand: undefined;

    /**
     * 列出指定工作目录的所有会话
     */
    listSessions(cwd: string): Promise<SessionInfo[]>;

    /**
     * 获取指定会话的所有消息
     */
    getSession(sessionIdOrPath: string, cwd: string): Promise<any[]>;
}

// ============================================================================
// 路径管理函数
// ============================================================================

/**
 * 获取特定项目的历史目录
 */
function getProjectHistoryDir(cwd: string, configDir: string): string {
    return path.join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

/**
 * UUID 正则表达式
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 验证 UUID
 */
function validateSessionId(id: string): string | null {
    return typeof id !== "string" ? null : UUID_REGEX.test(id) ? id : null;
}

/**
 * 读取 JSONL 文件
 */
async function readJSONL(filePath: string): Promise<SessionMessage[]> {
    try {
        const content = await fs.readFile(filePath, "utf8");
        if (!content.trim()) {
            return [];
        }

        return content
            .split("\n")
            .filter(line => line.trim())
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(obj => obj !== null) as SessionMessage[];
    } catch {
        return [];
    }
}

/**
 * 转换消息格式（用于返回给前端）
 *
 * 对于 sidechain 消息（Task 子 agent 产生的消息），传入 parentToolUseId
 * 以便前端将其挂载到正确的 Task tool_use 的 childTools 上。
 */
function convertMessage(msg: SessionMessage, parentToolUseId: string | null = null): any | undefined {
    if (msg.isMeta) {
        return undefined;
    }

    if (msg.type === "user") {
        return {
            type: "user",
            message: msg.message,
            session_id: msg.uuid,
            parent_tool_use_id: parentToolUseId,
            toolUseResult: msg.toolUseResult
        };
    }

    if (msg.type === "assistant") {
        return {
            type: "assistant",
            message: msg.message,
            session_id: msg.uuid,
            parent_tool_use_id: parentToolUseId,
            uuid: msg.message?.id
        };
    }

    if (msg.type === "system" || msg.type === "attachment") {
        return undefined;
    }

    return undefined;
}

/**
 * 为 sidechain 消息解析其所属的 Task tool_use id。
 *
 * Claude Code 将 Task 子 agent 的消息以 sidechain 形式存储在同一个 JSONL 中：
 * - sidechain 根消息的 parentUuid 指向主线上发起 Task 的 assistant 消息
 * - 后续 sidechain 消息通过 parentUuid 相互串联
 *
 * 本函数沿 parentUuid 向上走，直到遇到非 sidechain 祖先，然后在该祖先的
 * content 中查找 Task 类型的 tool_use block，用其 id 作为 parent_tool_use_id。
 *
 * 注：嵌套 Task 会解析到最外层的 Task id（嵌套场景较少见）。
 */
function resolveParentToolUseId(
    msg: SessionMessage,
    messages: Map<string, SessionMessage>,
    cache: Map<string, string>
): string | undefined {
    if (!msg.isSidechain) return undefined;
    const cached = cache.get(msg.uuid);
    if (cached) return cached;

    let cursor: SessionMessage | undefined = msg;
    while (cursor?.isSidechain) {
        cursor = cursor.parentUuid ? messages.get(cursor.parentUuid) : undefined;
    }
    if (!cursor) return undefined;

    const content = cursor.message?.content;
    if (!Array.isArray(content)) return undefined;

    const taskUse = content.find(
        (b: any) => b?.type === 'tool_use' && b?.name === 'Task'
    );
    const id: string | undefined = taskUse?.id;
    if (id) cache.set(msg.uuid, id);
    return id;
}

/**
 * 生成会话摘要
 */
function generateSummary(messages: SessionMessage[]): string {
    let firstUserMessage: SessionMessage | undefined;

    for (const msg of messages) {
        if (msg.type === "user" && !msg.isMeta) {
            firstUserMessage = msg;
        } else if (firstUserMessage) {
            break;
        }
    }

    if (!firstUserMessage || firstUserMessage.type !== "user") {
        return "No prompt";
    }

    const content = firstUserMessage.message?.content;
    let text = "";

    if (typeof content === "string") {
        text = content;
    } else if (Array.isArray(content)) {
        // 从后向前查找最后一个 text 类型的项
        const textItems = content.filter((item: any) => item.type === "text");
        text = textItems.length > 0 ? textItems[textItems.length - 1]?.text || "No prompt" : "No prompt";
    } else {
        text = "No prompt";
    }

    // 去除换行符并截断
    text = text.replace(/\n/g, " ").trim();
    if (text.length > 45) {
        text = text.slice(0, 45) + "...";
    }

    return text;
}


// ============================================================================
// ClaudeSessionService 实现
// ============================================================================

/**
 * 会话数据容器
 */
interface SessionData {
    sessionMessages: Map<string, Set<string>>;
    messages: Map<string, SessionMessage>;
    summaries: Map<string, string>;
}

/**
 * 加载项目的会话历史
 */
async function loadProjectData(cwd: string, configDir: string): Promise<SessionData> {
    const projectDir = getProjectHistoryDir(cwd, configDir);

    let files: string[];
    try {
        files = await fs.readdir(projectDir);
    } catch {
        return {
            sessionMessages: new Map(),
            messages: new Map(),
            summaries: new Map()
        };
    }

    const fileStats = await Promise.all(
        files.map(async file => {
            const filePath = path.join(projectDir, file);
            const stat = await fs.stat(filePath);
            return { name: filePath, stat };
        })
    );

    const jsonlFiles = fileStats
        .filter(file => file.stat.isFile() && file.name.endsWith(".jsonl"))
        .sort((a, b) => a.stat.mtime.getTime() - b.stat.mtime.getTime());

    const loadedData = await Promise.all(
        jsonlFiles.map(async file => {
            const sessionId = validateSessionId(path.basename(file.name, ".jsonl"));

            if (!sessionId) {
                return {
                    sessionId,
                    sessionMessages: new Map<string, SessionMessage>(),
                    summaries: new Map<string, string>()
                };
            }

            const messages = new Map<string, SessionMessage>();
            const summaries = new Map<string, string>();

            try {
                for (const msg of await readJSONL(file.name)) {
                    if (
                        msg.type === "user" ||
                        msg.type === "assistant" ||
                        msg.type === "attachment" ||
                        msg.type === "system"
                    ) {
                        messages.set(msg.uuid, msg);
                    } else if (msg.type === "summary" && msg.leafUuid) {
                        summaries.set(msg.leafUuid, msg.summary!);
                    }
                }
            } catch {
            }

            return { sessionId, sessionMessages: messages, summaries };
        })
    );

    const sessionMessages = new Map<string, Set<string>>();
    const allMessages = new Map<string, SessionMessage>();
    const allSummaries = new Map<string, string>();

    for (const { sessionId, sessionMessages: messages, summaries } of loadedData) {
        if (!sessionId) continue;

        sessionMessages.set(sessionId, new Set(messages.keys()));

        for (const [uuid, msg] of messages.entries()) {
            allMessages.set(uuid, msg);
        }

        for (const [uuid, summary] of summaries.entries()) {
            allSummaries.set(uuid, summary);
        }
    }

    return {
        sessionMessages,
        messages: allMessages,
        summaries: allSummaries
    };
}

/**
 * 获取所有会话的对话链
 */
function getTranscripts(data: SessionData): SessionMessage[][] {
    const allMessages = [...data.messages.values()];

    const referencedUuids = new Set(
        allMessages.map(msg => msg.parentUuid).filter(Boolean) as string[]
    );

    const rootMessages = allMessages.filter(msg => !referencedUuids.has(msg.uuid));

    return rootMessages
        .map(msg => getTranscript(msg, data))
        .filter(transcript => transcript.length > 0);
}

/**
 * 重建完整的对话链
 */
function getTranscript(message: SessionMessage, data: SessionData): SessionMessage[] {
    const result: SessionMessage[] = [];
    let current: SessionMessage | undefined = message;

    while (current) {
        result.unshift(current);
        current = current.parentUuid ? data.messages.get(current.parentUuid) : undefined;
    }

    return result;
}


// ============================================================================
// ClaudeSessionService 实现
// ============================================================================

/**
 * Claude 会话服务实现
 */
export class ClaudeSessionService implements IClaudeSessionService {
    readonly _serviceBrand: undefined;

    constructor(
        @ILogService private readonly logService: ILogService,
        @IConfigurationService private readonly configService: IConfigurationService
    ) {
        this.logService.info('[ClaudeSessionService] 已初始化');
    }

    private async resolveConfigDir(): Promise<string> {
        const fromSetting = await this.configService.getConfigurationDirectory();
        const resolved = fromSetting
            ?? process.env.CLAUDE_CONFIG_DIR
            ?? path.join(os.homedir(), '.claude');
        this.logService.info(`[ClaudeSessionService] resolveConfigDir: setting=${fromSetting ?? '(not set)'}, resolved=${resolved}`);
        return resolved;
    }

    /**
     * 列出指定工作目录的所有会话
     */
    async listSessions(cwd: string): Promise<SessionInfo[]> {
        try {
            this.logService.info(`[ClaudeSessionService] Loading session list: ${cwd}`);

            const configDir = await this.resolveConfigDir();
            const data = await loadProjectData(cwd, configDir);

            const transcripts = getTranscripts(data);

            const sessions = transcripts.map(transcript => {
                const lastMessage = transcript[transcript.length - 1];
                const firstMessage = transcript[0];
                const summary = generateSummary(transcript);

                return {
                    lastModified: new Date(lastMessage.timestamp).getTime(),
                    messageCount: transcript.length,
                    isSidechain: firstMessage.isSidechain,
                    id: lastMessage.sessionId,
                    summary: data.summaries.get(lastMessage.uuid) || summary,
                    isCurrentWorkspace: true
                };
            });

            this.logService.info(`[ClaudeSessionService] Found ${sessions.length} sessions`);
            return sessions;
        } catch (error) {
            this.logService.error(`[ClaudeSessionService] Failed to load session list:`, error);
            return [];
        }
    }

    /**
     * 获取指定会话的所有消息
     */
    async getSession(sessionIdOrPath: string, cwd: string): Promise<any[]> {
        try {
            this.logService.info(`[ClaudeSessionService] Getting session messages: ${sessionIdOrPath}`);

            if (sessionIdOrPath.endsWith(".jsonl")) {
                const messages: any[] = [];
                for (const msg of await readJSONL(sessionIdOrPath)) {
                    messages.push(msg);
                }
                return messages;
            }

            const configDir = await this.resolveConfigDir();
            const data = await loadProjectData(cwd, configDir);

            const messageUuids = data.sessionMessages.get(sessionIdOrPath);
            if (!messageUuids) {
                return [];
            }

            const sessionMessageList = Array.from(data.messages.values())
                .filter(msg => messageUuids.has(msg.uuid));

            // 挑选最近一次的主线（非 sidechain）leaf，按 parentUuid 反向重建主线。
            const latestMain = sessionMessageList
                .filter(msg => !msg.isSidechain)
                .sort((a, b) =>
                    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                )[0];
            if (!latestMain) {
                return [];
            }

            const mainTranscript = getTranscript(latestMain, data);
            const mainUuidSet = new Set(mainTranscript.map(m => m.uuid));

            // 收集属于本次主线的 sidechain 消息（其 Task 祖先在 mainTranscript 中）。
            const toolUseCache = new Map<string, string>();
            const sidechainMessages: Array<{ msg: SessionMessage; parentToolUseId: string }> = [];
            for (const msg of sessionMessageList) {
                if (!msg.isSidechain) continue;
                const parentToolUseId = resolveParentToolUseId(msg, data.messages, toolUseCache);
                if (!parentToolUseId) continue;

                // 确认该 Task tool_use 所在的 assistant 消息在当前主线里。
                let cursor: SessionMessage | undefined = msg;
                while (cursor?.isSidechain) {
                    cursor = cursor.parentUuid ? data.messages.get(cursor.parentUuid) : undefined;
                }
                if (!cursor || !mainUuidSet.has(cursor.uuid)) continue;

                sidechainMessages.push({ msg, parentToolUseId });
            }

            // 按时间顺序合并主线与 sidechain 消息。subagent 的消息夹在
            // Task tool_use 和其 tool_result 之间，时间戳单调递增。
            type Entry = { msg: SessionMessage; parentToolUseId: string | null };
            const merged: Entry[] = [];
            for (const m of mainTranscript) merged.push({ msg: m, parentToolUseId: null });
            for (const s of sidechainMessages) merged.push({ msg: s.msg, parentToolUseId: s.parentToolUseId });
            merged.sort((a, b) =>
                new Date(a.msg.timestamp).getTime() - new Date(b.msg.timestamp).getTime()
            );

            const result = merged
                .map(({ msg, parentToolUseId }) => convertMessage(msg, parentToolUseId))
                .filter(msg => !!msg);

            this.logService.info(
                `[ClaudeSessionService] Retrieved ${result.length} messages ` +
                `(${mainTranscript.length} main + ${sidechainMessages.length} sidechain)`
            );
            return result;
        } catch (error) {
            this.logService.error(`[ClaudeSessionService] Failed to retrieve session messages:`, error);
            return [];
        }
    }

}
