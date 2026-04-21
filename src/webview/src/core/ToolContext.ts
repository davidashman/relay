/**
 * ToolContext - Tool
 *
 * Tool
 */

import { signal } from 'alien-signals';

type Signal<T> = ReturnType<typeof signal<T>>;

/**
 * Tool
 */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  is_error?: boolean;
  [key: string]: any;
}

export class ToolContext {
  public readonly channelId: string;
  public readonly toolName: string;
  public readonly inputs: any;

  private toolResultSignal: Signal<ToolResult | undefined>;

  constructor(channelId: string, toolName: string, inputs: any) {
    this.channelId = channelId;
    this.toolName = toolName;
    this.inputs = inputs;
    this.toolResultSignal = signal<ToolResult | undefined>(undefined);
  }

  /**
   * Tool Signal
   */
  get toolResult(): Signal<ToolResult | undefined> {
    return this.toolResultSignal;
  }

  /**
   * Tool
   * @param result Tool
   */
  setToolResult(result: ToolResult): void {
    this.toolResultSignal(result);
  }

  /**
   * Tool
   */
  isSuccess(): boolean {
    const result = this.toolResultSignal();
    return result ? result.success && !result.is_error : false;
  }

  /**
   * Tool
   */
  isError(): boolean {
    const result = this.toolResultSignal();
    return result ? !result.success || result.is_error === true : false;
  }

  /**
   */
  getErrorMessage(): string | undefined {
    const result = this.toolResultSignal();
    return result?.error;
  }

  /**
   */
  getOutput(): string | undefined {
    const result = this.toolResultSignal();
    return result?.output;
  }
}
