/**
 * ContentBlockWrapper - Content Block
 *
 * alien-signals tool_result
 *
 * 1. content block
 * 2. Signal toolResult
 * 3. setToolResult
 *
 * - tool_use tool_result
 * - tool_result tool_use
 * - signal UI
 */

import { signal } from 'alien-signals';
import type { ContentBlockType, ToolResultBlock } from './ContentBlock';

export class ContentBlockWrapper {
  /**
   * content block
   */
  public readonly content: ContentBlockType;

  /**
   * Tool Result Signal
   * tool_result
   */
  private readonly toolResultSignal = signal<ToolResultBlock | undefined>(undefined);

  /**
   * Child tool wrappers ().
   * Populated for Task tool_use blocks: holds the tool_use blocks emitted by
   * the Task's subagent (tagged with parent_tool_use_id). The Task UI
   * renders these as an indented group under the Task header.
   */
  private readonly childToolsSignal = signal<ContentBlockWrapper[]>([]);

  /**
   * Tool Use Result
   * toolUseResult
   */
  public toolUseResult?: any;

  constructor(content: ContentBlockType) {
    this.content = content;
  }

  /**
   * toolResult signal
   *
   * @returns Alien signal
   */
  get toolResult() {
    return this.toolResultSignal;
  }

  /**
   * tool result
   *
   * 🔥 alien-signals API
   *
   * @param result Tool
   */
  setToolResult(result: ToolResultBlock): void {
    this.toolResultSignal(result);
  }

  /**
   * tool_result
   */
  hasToolResult(): boolean {
    return this.toolResultSignal() !== undefined;
  }

  /**
   * tool_result
   */
  getToolResultValue(): ToolResultBlock | undefined {
    return this.toolResultSignal();
  }

  /**
   * Child tools signal ().
   */
  get childTools() {
    return this.childToolsSignal;
  }

  /**
   * Append a child tool wrapper. Emits a new array reference so signal
   * subscribers (e.g. the Task UI) re-render.
   */
  addChildTool(child: ContentBlockWrapper): void {
    this.childToolsSignal([...this.childToolsSignal(), child]);
  }

  /**
   * Non-reactive snapshot of the current child tool list.
   */
  getChildToolsValue(): ContentBlockWrapper[] {
    return this.childToolsSignal();
  }
}
