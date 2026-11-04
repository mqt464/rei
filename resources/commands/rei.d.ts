declare module 'rei/commands' {
  export interface PlayingMedia {
    id: string
    title: string
    url: string
    sourceUrl: string
  }

  export interface CommandContext {
    activeTab: { media: { current(): Promise<PlayingMedia> } }
    downloads: { enqueue(media: PlayingMedia): Promise<string> }
  }

  export interface CommandDefinition {
    name: string
    command: string
    description: string
    version?: string
    intent: Partial<Record<'activeTab.media' | 'downloads.enqueue', string>>
    run(context: CommandContext): void | Promise<void>
  }

  export function defineCommand(definition: CommandDefinition): CommandDefinition
}
