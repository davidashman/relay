import type { CommandAction } from '../core/AppContext'
import type { RuntimeInstance } from '../composables/useRuntime'
import type { DropdownItemType } from '../types/dropdown'

/**
 * Slash Command
 *
 * CommandRegistry slash commands
 */

// section
export interface CommandWithSection extends CommandAction {
  section: string
}

/**
 * slash commands
 *
 * @param query
 * @param runtime Runtime
 * @param _signal ,
 * @returns
 */
export function getSlashCommands(
  query: string,
  runtime: RuntimeInstance | undefined,
  _signal?: AbortSignal
): CommandAction[] {
  if (!runtime) return []

  const commandsBySection = runtime.appContext.commandRegistry.getCommandsBySection()
  const allCommands = commandsBySection['Slash Commands'] || []

  if (!query || !query.trim()) return allCommands

  // label description
  const lowerQuery = query.toLowerCase()
  return allCommands.filter(cmd =>
    cmd.label.toLowerCase().includes(lowerQuery) ||
    cmd.description?.toLowerCase().includes(lowerQuery)
  )
}

/**
 * slash commands ButtonArea
 *
 * @param query
 * @param runtime Runtime
 * @returns
 */
export function getSlashCommandsWithSection(
  query: string,
  runtime: RuntimeInstance | undefined
): CommandWithSection[] {
  if (!runtime) return []

  const commandsBySection = runtime.appContext.commandRegistry.getCommandsBySection()
  const results: CommandWithSection[] = []

  const SECTION_ORDER = ['Slash Commands'] as const

  for (const section of SECTION_ORDER) {
    const commands = commandsBySection[section]
    if (!commands || commands.length === 0) continue

    const lowerQuery = query.toLowerCase()
    const filteredCommands = query
      ? commands.filter(cmd =>
          cmd.label.toLowerCase().includes(lowerQuery) ||
          cmd.description?.toLowerCase().includes(lowerQuery)
        )
      : commands

    for (const cmd of filteredCommands) {
      results.push({
        ...cmd,
        section
      })
    }
  }

  return results
}

/**
 * CommandAction DropdownItemType
 *
 * @param command
 * @returns Dropdown
 */
export function commandToDropdownItem(command: CommandAction): DropdownItemType {
  return {
    id: command.id,
    label: command.label,
    detail: command.description,
    icon: 'codicon-symbol-method',
    type: 'command',
    data: { commandId: command.id, command }
  }
}

/**
 *
 * @param command
 * @returns
 */
export function getCommandIcon(command: CommandAction): string | undefined {
  const label = command.label.toLowerCase()

  // Slash commands
  if (label.startsWith('/')) {
    return 'codicon-symbol-method'
  }

  return undefined
}
