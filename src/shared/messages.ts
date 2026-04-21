/**
 *
 * Extension ↔ WebView
 */

//  SDK
import type {
    SDKMessage,
    SDKUserMessage,
    PermissionResult,
    PermissionUpdate,
    PermissionMode
} from '@anthropic-ai/claude-agent-sdk';

// ============================================================================
// ============================================================================

/**
 */
export interface BaseMessage {
    type: string;
    //  WebView
    webviewId?: string;
}

// ============================================================================
// WebView → Extension
// ============================================================================

/**
 *  Claude
 */
export interface LaunchClaudeMessage extends BaseMessage {
    type: "launch_claude";
    channelId: string;
    resume?: string | null;        //  ID
    cwd?: string;                  //
    model?: string | null;         //
    permissionMode?: PermissionMode; //
    thinkingLevel?: string | null; // Thinking off | default_on
    effortLevel?: string | null;   // Effort low | medium | high Opus 4.6+
}

/**
 */
export interface IOMessage extends BaseMessage {
    type: "io_message";
    channelId: string;
    message: SDKMessage | SDKUserMessage;  // SDK
    done: boolean;                         //
}

/**
 *  Claude
 */
export interface InterruptClaudeMessage extends BaseMessage {
    type: "interrupt_claude";
    channelId: string;
}

/**
 */
export interface CloseChannelMessage extends BaseMessage {
    type: "close_channel";
    channelId: string;
    error?: string;
}

/**
 * SDK Extension → WebView
 *
 *  SDK stderr
 */
export interface LLMRequestErrorMessage extends BaseMessage {
    type: "sdk_error";
    channelId: string;
    /**  */
    error: string;
    /** HTTP  (e.g. 401, 503) */
    statusCode: string;
    /**  (e.g. authentication_error, new_api_error) */
    errorType: string;
}

// ============================================================================
// -
// ============================================================================

/**
 */
export interface RequestMessage<T = any> extends BaseMessage {
    type: "request";
    channelId?: string;
    requestId: string;
    request: T;
}

/**
 */
export interface ResponseMessage<T = any> extends BaseMessage {
    type: "response";
    requestId: string;
    response: T | ErrorResponse;
}

/**
 */
export interface ErrorResponse {
    type: "error";
    error: string;
}

/**
 */
export interface CancelRequestMessage extends BaseMessage {
    type: "cancel_request";
    targetRequestId: string;
}

// ============================================================================
// WebView → Extension
// ============================================================================

/**
 */
export interface InitRequest {
    type: "init";
}

export interface InitResponse {
    type: "init_response";
    state: {
        defaultCwd: string;
        openNewInTab: boolean;
        // authStatus: null | { authenticated: boolean };
        modelSetting: string;
        platform: string;
        thinkingLevel?: string;        // Thinking off | on | extended
        effortLevel?: string;          // Effort low | medium | high Opus 4.6+
        permissionMode?: string;       // Permission mode (default | acceptEdits | plan)
        expandToolOutput?: boolean;    // Expand tool output by default
        showThinking?: boolean;        // Show thinking blocks in chat
    };
}

/**
 */
export interface OpenFileRequest {
    type: "open_file";
    filePath: string;
    location?: {
        startLine?: number;
        endLine?: number;
        startColumn?: number;
        endColumn?: number;
    };
}

export interface OpenFileResponse {
    type: "open_file_response";
}

/**
 *  Diff
 */
export interface OpenDiffRequest {
    type: "open_diff";
    originalFilePath: string;
    newFilePath: string;
    edits: Array<{
        oldString: string;
        newString: string;
        replaceAll?: boolean;
    }>;
    supportMultiEdits: boolean;
}

export interface OpenDiffResponse {
    type: "open_diff_response";
    newEdits: Array<{
        oldString: string;
        newString: string;
        replaceAll?: boolean;
    }>;
}

/**
 */
export interface SetPermissionModeRequest {
    type: "set_permission_mode";
    mode: PermissionMode;
}

export interface SetPermissionModeResponse {
    type: "set_permission_mode_response";
    success: boolean;
}

/**
 */
export interface ModelOption {
    value: string;
    label?: string;
    description?: string;
    provider?: string;
}

/**
 */
export interface SetModelRequest {
    type: "set_model";
    model: ModelOption;
}

export interface SetModelResponse {
    type: "set_model_response";
    success: boolean;
}

/**
 *  Thinking Level
 */
export interface SetThinkingLevelRequest {
    type: "set_thinking_level";
    channelId: string;
    thinkingLevel: string;  // "off" | "default_on"
}

export interface SetThinkingLevelResponse {
    type: "set_thinking_level_response";
}

/**
 *  Effort LevelOpus 4.6+ adaptive reasoning
 */
export interface SetEffortLevelRequest {
    type: "set_effort_level";
    channelId: string;
    effortLevel: string;  // "low" | "medium" | "high"
}

export interface SetEffortLevelResponse {
    type: "set_effort_level_response";
}

/**
 *  Claude
 */
export interface GetClaudeStateRequest {
    type: "get_claude_state";
}

export interface GetClaudeStateResponse {
    type: "get_claude_state_response";
    config: any;
}

/**
 *  SDK
 */
export type SdkProbeCapability =
    | "supportedCommands"
    | "supportedModels"
    | "mcpServerStatus"
    | "accountInfo"
    | (string & {});

export interface SdkProbeRequest {
    type: "sdk_probe";
    capabilities: SdkProbeCapability[];
    timeoutMs?: number;
}

export interface SdkProbeResponse {
    type: "sdk_probe_response";
    data: Record<string, any>;
    errors?: Record<string, string>;
}

/**
 *  MCP
 */
export interface GetMcpServersRequest {
    type: "get_mcp_servers";
}

export interface GetMcpServersResponse {
    type: "get_mcp_servers_response";
    mcpServers: Array<{ name: string; status: string }>;
}

/**
 *  URI
 */
export interface GetAssetUrisRequest {
    type: "get_asset_uris";
}

export interface GetAssetUrisResponse {
    type: "asset_uris_response";
    assetUris: any;
}

/**
 */
export interface ListSessionsRequest {
    type: "list_sessions_request";
}

export interface ListSessionsResponse {
    type: "list_sessions_response";
    sessions: Array<{
        id: string;
        lastModified: number;
        messageCount: number;
        summary: string;
        worktree?: string;
        isCurrentWorkspace: boolean;
    }>;
}

/**
 */
export interface GetSessionRequest {
    type: "get_session_request";
    sessionId: string;
}

export interface GetSessionResponse {
    type: "get_session_response";
    messages: any[];
}

/**
 */
export interface ExecRequest {
    type: "exec";
    command: string;
    params: string[];
}

export interface ExecResponse {
    type: "exec_response";
    stdout: string;
    stderr: string;
    exitCode: number;
}

/**
 */
export interface ListFilesRequest {
    type: "list_files_request";
    pattern?: string;
}

export interface ListFilesResponse {
    type: "list_files_response";
    files: Array<{
        path: string;
        name: string;
        type: "file" | "directory";
    }>;
}

/**
 *  /
 */
export interface StatPathRequest {
    type: "stat_path_request";
    /**
     */
    paths: string[];
}

export interface StatPathResponse {
    type: "stat_path_response";
    entries: Array<{
        path: string;
        /**
         * file / directory / other / not_found
         */
        type: "file" | "directory" | "other" | "not_found";
    }>;
}

/**
 */
export interface OpenContentRequest {
    type: "open_content";
    content: string;
    fileName: string;
    editable: boolean;
}

export interface OpenContentResponse {
    type: "open_content_response";
    updatedContent?: string;
}

/**
 *  base64 /
 */
export interface OpenAttachmentRequest {
    type: "open_attachment";
    fileName: string;
    mediaType: string;
    data: string; // base64  data:
}

export interface OpenAttachmentResponse {
    type: "open_attachment_response";
}

/**
 */
export interface SelectionRange {
    filePath: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
    selectedText: string;
}

export interface GetCurrentSelectionRequest {
    type: "get_current_selection";
}

export interface GetCurrentSelectionResponse {
    type: "get_current_selection_response";
    selection: SelectionRange | null;
}

/**
 *  URL
 */
export interface OpenURLRequest {
    type: "open_url";
    url: string;
}

export interface OpenURLResponse {
    type: "open_url_response";
}

/**
 */
export interface ShowNotificationRequest {
    type: "show_notification";
    message: string;
    severity: "info" | "warning" | "error";
    buttons?: string[];
    onlyIfNotVisible?: boolean;
}

export interface ShowNotificationResponse {
    type: "show_notification_response";
    buttonValue?: string;
}

/**
 *  →
 */
export interface OpenSessionPanelRequest {
    type: "open_session_panel";
    sessionId: string | null; // null = new session
    title?: string;
}

export interface OpenSessionPanelResponse {
    type: "open_session_panel_response";
}

/**
 */
export interface NewConversationTabRequest {
    type: "new_conversation_tab";
    initialPrompt?: string;
}

export interface NewConversationTabResponse {
    type: "new_conversation_tab_response";
}

/**
 */
export interface RenameTabRequest {
    type: "rename_tab";
    title: string;
}

export interface RenameTabResponse {
    type: "rename_tab_response";
}

/**
 *  ID
 */
export interface UpdatePanelSessionRequest {
    type: "update_panel_session";
    sessionId: string | null;
}

export interface UpdatePanelSessionResponse {
    type: "update_panel_session_response";
}

/**
 */
// export interface GetAuthStatusRequest {
//     type: "get_auth_status";
// }

// export interface GetAuthStatusResponse {
//     type: "get_auth_status_response";
//     status: null | { authenticated: boolean };
// }

/**
 */
// export interface LoginRequest {
//     type: "login";
//     method: "claude.ai" | "console.anthropic.com";
// }

// export interface LoginResponse {
//     type: "login_response";
//     auth: {
//         authenticated: boolean;
//         apiKey?: string;
//     };
// }

/**
 *  OAuth
 */
// export interface SubmitOAuthCodeRequest {
//     type: "submit_oauth_code";
//     code: string;
// }

// export interface SubmitOAuthCodeResponse {
//     type: "submit_oauth_code_response";
// }

/**
 */
export interface OpenConfigFileRequest {
    type: "open_config_file";
    configType: string;
}

export interface OpenConfigFileResponse {
    type: "open_config_file_response";
}

/**
 *  Claude
 */
export interface OpenClaudeInTerminalRequest {
    type: "open_claude_in_terminal";
}

export interface OpenClaudeInTerminalResponse {
    type: "open_claude_in_terminal_response";
}

/**
 *  URL Extension → WebView
 */
// export interface AuthURLRequest {
//     type: "auth_url";
//     url: string;
//     method: string;
// }


/**
 */
export interface GetSettingsRequest {
    type: "get_settings";
}

export interface GetSettingsResponse {
    type: "get_settings_response";
    settings: any;
  // New fields for Profile Management
  activeProfile: string | null;
  profiles: string[];
  hasWorkspace: boolean;
  metadata?: Record<
    string,
    {
      effectiveScope: 'managed' | 'cli' | 'profile' | 'local' | 'shared' | 'global' | 'default';
      values: {
        managed?: any;
        cli?: any;
        profile?: any;
        local?: any;
        shared?: any;
        global?: any;
        default?: any;
      };
    }
  >;
}

/**
 *  Profile
 */
export interface SwitchProfileRequest {
  type: 'switch_profile';
  profile: string | null; // null for default
}

export interface SwitchProfileResponse {
  type: 'switch_profile_response';
  success: boolean;
}

/**
 *  Profile
 */
export interface CreateProfileRequest {
  type: 'create_profile';
  name: string;
}

export interface CreateProfileResponse {
  type: 'create_profile_response';
  success: boolean;
  error?: string;
}

/**
 *  Profile
 */
export interface DeleteProfileRequest {
  type: 'delete_profile';
  name: string;
}

export interface DeleteProfileResponse {
  type: 'delete_profile_response';
  success: boolean;
  error?: string;
}

/**
 */
export interface UpdateSettingRequest {
    type: "update_setting";
    key: string;
    value: any;
    target?: 'local' | 'shared' | 'global';
}

export interface UpdateSettingResponse {
    type: "update_setting_response";
    success: boolean;
}

/**
 */
export interface ResetSettingRequest {
    type: "reset_setting";
    key: string;
    target: 'local' | 'shared' | 'global';
}

export interface ResetSettingResponse {
    type: "reset_setting_response";
    success: boolean;
}

/**
 *  (~/.relay.json)
 */
export interface GetExtensionConfigRequest {
    type: "get_extension_config";
}

export interface GetExtensionConfigResponse {
    type: "get_extension_config_response";
    config: {
        activeProfile: string | null;
        defaultModel: string;
        systemNotifications: boolean;
        completionSound: boolean;
        customModels: Array<{ id: string; name?: string }>;
        disabledModels: string[];
    };
}

/**
 */
export interface UpdateExtensionConfigRequest {
    type: "update_extension_config";
    key: string;
    value: any;
}

export interface UpdateExtensionConfigResponse {
    type: "update_extension_config_response";
    success: boolean;
}

// ============================================================================
// Extension → WebView
// ============================================================================

/**
 */
export interface ToolPermissionRequest {
    type: "tool_permission_request";
    toolName: string;
    inputs: Record<string, unknown>;
    suggestions: PermissionUpdate[];
}

export interface ToolPermissionResponse {
    type: "tool_permission_response";
    result: PermissionResult;
}

/**
 * @
 */
export interface InsertAtMentionRequest {
    type: "insert_at_mention";
    text: string;
}

/**
 */
export interface SelectionChangedRequest {
    type: "selection_changed";
    selection: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
}

/**
 *  (Extension → WebView broadcast)
 */
export interface ExtensionConfigChangedRequest {
    type: "extension_config_changed";
    key: string;
    value: any;
}

/**
 */
export interface UpdateStateRequest {
    type: "update_state";
    //  init_response.state
    state: Partial<InitResponse['state']>;
    //  Claude
    config?: GetClaudeStateResponse['config'];
}

/**
 * WebView → Extension
 */
export interface FocusChangedMessage extends BaseMessage {
    type: "focus_changed";
    focused: boolean;
}

// ============================================================================
// ============================================================================

/**
 *  WebView → Extension
 */
export type WebViewToExtensionMessage =
    | LaunchClaudeMessage
    | IOMessage
    | InterruptClaudeMessage
    | CloseChannelMessage
    | RequestMessage
    | ResponseMessage
    | CancelRequestMessage
    | FocusChangedMessage;

/**
 *  Extension → WebView
 */
export type ExtensionToWebViewMessage =
    | IOMessage
    | CloseChannelMessage
    | LLMRequestErrorMessage
    | RequestMessage
    | ResponseMessage;

/**
 * Extension
 */
export interface FromExtensionWrapper {
    type: "from-extension";
    message: ExtensionToWebViewMessage;
}

// ============================================================================
// ============================================================================

/**
 * WebView → Extension
 */
export type WebViewRequest =
    | InitRequest
    | OpenFileRequest
    | OpenDiffRequest
    | OpenContentRequest
    | OpenAttachmentRequest
    | SetPermissionModeRequest
    | SetModelRequest
    | SetThinkingLevelRequest
    | SetEffortLevelRequest
    | GetCurrentSelectionRequest
    | ShowNotificationRequest
    | NewConversationTabRequest
    | RenameTabRequest
    | UpdatePanelSessionRequest
    | GetClaudeStateRequest
    | SdkProbeRequest
    | GetMcpServersRequest
    | GetAssetUrisRequest
    | ListSessionsRequest
    | GetSessionRequest
    | ExecRequest
    | ListFilesRequest
    | OpenURLRequest
    | StatPathRequest
    // | GetAuthStatusRequest
    // | LoginRequest
    // | SubmitOAuthCodeRequest
    | OpenConfigFileRequest
    | OpenClaudeInTerminalRequest
    | GetSettingsRequest
    | UpdateSettingRequest
    | ResetSettingRequest
    | SwitchProfileRequest
    | CreateProfileRequest
    | DeleteProfileRequest
    | GetExtensionConfigRequest
    | UpdateExtensionConfigRequest
    | OpenSessionPanelRequest;

/**
 * Extension → WebView
 */
export type WebViewRequestResponse =
    | InitResponse
    | OpenFileResponse
    | OpenDiffResponse
    | OpenContentResponse
    | OpenAttachmentResponse
    | SetPermissionModeResponse
    | SetModelResponse
    | SetThinkingLevelResponse
    | SetEffortLevelResponse
    | GetCurrentSelectionResponse
    | ShowNotificationResponse
    | NewConversationTabResponse
    | RenameTabResponse
    | UpdatePanelSessionResponse
    | GetClaudeStateResponse
    | SdkProbeResponse
    | GetMcpServersResponse
    | GetAssetUrisResponse
    | ListSessionsResponse
    | GetSessionResponse
    | ExecResponse
    | ListFilesResponse
    | OpenURLResponse
    | StatPathResponse
    // | GetAuthStatusResponse
    // | LoginResponse
    // | SubmitOAuthCodeResponse
    | OpenConfigFileResponse
    | OpenConfigFileResponse
    | OpenClaudeInTerminalResponse
    | GetSettingsResponse
    | UpdateSettingResponse
    | ResetSettingResponse
    | SwitchProfileResponse
    | CreateProfileResponse
    | DeleteProfileResponse
    | GetExtensionConfigResponse
    | UpdateExtensionConfigResponse
    | OpenSessionPanelResponse;

/**
 * Extension → WebView
 */
export interface NewTabRequest {
    type: "new_tab";
}

/**
 * Extension → WebView
 */
export interface CloseTabRequest {
    type: "close_tab";
}

/**
 * Extension → WebView
 */
export type ExtensionRequest =
    | ToolPermissionRequest
    | InsertAtMentionRequest
    | SelectionChangedRequest
    | UpdateStateRequest
    | VisibilityChangedRequest
    | NewTabRequest
    | CloseTabRequest;
    // | AuthURLRequest;

/**
 * Extension → WebView
 *
 * Analyze/extension.unpack.js:2648-2656
 */
export interface VisibilityChangedRequest {
    type: "visibility_changed";
    isVisible: boolean;
}

/**
 * WebView → Extension
 */
export type ExtensionRequestResponse =
    | ToolPermissionResponse;
