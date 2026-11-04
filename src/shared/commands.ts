export const commandPermissions = {
  'activeTab.media': {
    title: 'Read playing media',
    description:
      'Read media titles, addresses, and playback state in the active tab, including embedded players.'
  },
  'downloads.enqueue': {
    title: 'Download media',
    description:
      'Save detected media to your download folder using Rei’s media downloader. No cookies are shared.'
  }
} as const

export type CommandPermission = keyof typeof commandPermissions
export type CommandIntent = Partial<Record<CommandPermission, string>>

export interface PlayingMedia {
  id: string
  title: string
  url: string
  sourceUrl: string
}

export interface CommandContext {
  activeTab: { media: { current: () => Promise<PlayingMedia> } }
  downloads: { enqueue: (media: PlayingMedia) => Promise<string> }
}

export interface CommandDefinition {
  name: string
  command: string
  description: string
  version?: string
  intent: CommandIntent
  run: (context: CommandContext) => void | Promise<void>
}

export interface InstalledCommand extends Omit<CommandDefinition, 'run'> {
  id: string
  enabled: boolean
  grants: CommandPermission[]
  error?: string
}

export interface CommandsState {
  commands: InstalledCommand[]
  error: string
}

export interface CommandResult {
  kind: 'command'
  id: string
  commandId: string
  title: string
  description: string
  unavailable: string
}

export function commandUnavailable(command: InstalledCommand): string {
  if (command.error) return command.error
  if (!command.enabled) return 'Disabled in Settings → Commands.'
  if (Object.keys(command.intent).some((key) => !command.grants.includes(key as CommandPermission)))
    return 'Allow requested access in Settings → Commands.'
  return ''
}

export function commandResults(query: string, commands: InstalledCommand[]): CommandResult[] {
  const text = query.trim().slice(1).toLowerCase()
  return commands
    .filter((command) => command.enabled && command.command.startsWith(text))
    .sort((first, second) => first.command.localeCompare(second.command))
    .map((command) => ({
      kind: 'command',
      id: `command:${command.id}`,
      commandId: command.id,
      title: `/${command.command}`,
      description: command.description,
      unavailable: commandUnavailable(command)
    }))
}
