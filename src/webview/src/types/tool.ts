/**
 * Tool UI
 * Tool
 */
export interface ToolContext {
  fileOpener: {
    open: (filePath: string, location?: { startLine?: number; endLine?: number }) => void;
    openContent: (content: string, fileName: string, editable: boolean) => void;
    openAttachment: (fileName: string, mediaType: string, data: string) => void;
  };
}

/**
 * Tool
 * Tool UI
 */
export interface ToolPermissionRenderer {
  /**
   * UI
   * @param context Tool
   * @param inputs Tool
   * @param onModify
   */
  renderPermissionRequest(
    context: ToolContext,
    inputs: any,
    onModify?: (newInputs: any) => void
  ): any;
}
