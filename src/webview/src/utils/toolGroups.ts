const STANDALONE_TOOLS = new Set(['Agent', 'Task', 'Edit', 'Write', 'TodoWrite']);

export function isGroupableTool(name: string): boolean {
  return !STANDALONE_TOOLS.has(name);
}
