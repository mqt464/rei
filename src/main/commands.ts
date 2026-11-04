import { app, session, shell, WebContentsView } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  watch,
  writeFileSync
} from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { commandPermissions, commandUnavailable } from '../shared/commands'
import type {
  CommandIntent,
  CommandPermission,
  CommandsState,
  InstalledCommand,
  PlayingMedia
} from '../shared/commands'
import { currentPlayingMedia } from './playing-media'
import { enqueueMediaDownload } from './media-downloads'
import { commandSandboxBootstrap } from './command-sandbox'

type SavedCommand = { enabled: boolean; grants: Partial<Record<CommandPermission, string>> }
type SavedCommands = { initialized: boolean; commands: Record<string, SavedCommand> }
type CommandFile = { source: string; hash: string; command: InstalledCommand }

export class CommandRuntime {
  readonly directory = join(app.getPath('userData'), 'commands')
  private readonly settingsFile = join(app.getPath('userData'), 'commands.json')
  private saved: SavedCommands = { initialized: false, commands: {} }
  private files = new Map<string, CommandFile>()
  private clients = new Set<WebContents>()
  private state: CommandsState = { commands: [], error: '' }
  private watcher?: FSWatcher
  private timer?: ReturnType<typeof setTimeout>
  private refreshing?: Promise<CommandsState>
  private ready?: Promise<CommandsState>
  private running = new Set<WebContentsView>()
  private disposed = false

  initialize(): Promise<CommandsState> {
    this.ready ??= this.setup().catch((failure) => {
      this.ready = undefined
      throw failure
    })
    return this.ready
  }

  private async setup(): Promise<CommandsState> {
    mkdirSync(this.directory, { recursive: true })
    if (existsSync(this.settingsFile)) {
      if (lstatSync(this.settingsFile).size > 256 * 1024)
        throw new Error('Commands settings exceed 256 KB.')
      const saved = JSON.parse(readFileSync(this.settingsFile, 'utf8'))
      if (
        saved?.initialized !== true ||
        !saved.commands ||
        typeof saved.commands !== 'object' ||
        Array.isArray(saved.commands)
      )
        throw new Error('Invalid commands.json. Fix the file before loading commands.')
      this.saved = saved
    }
    const bundled = app.isPackaged
      ? join(process.resourcesPath, 'commands')
      : join(__dirname, '../../resources/commands')
    for (const filename of ['rei.d.ts', 'tsconfig.json']) {
      const destination = join(this.directory, filename)
      if (!existsSync(destination))
        writeFileSync(destination, readFileSync(join(bundled, filename)), {
          flag: 'wx',
          mode: 0o600
        })
    }
    if (!this.saved.initialized) {
      const destination = join(this.directory, 'download.ts')
      if (!existsSync(destination))
        writeFileSync(destination, readFileSync(join(bundled, 'download.ts')), {
          flag: 'wx',
          mode: 0o600
        })
      this.saved.initialized = true
      this.save()
    }
    this.watcher = watch(this.directory, (_event, filename) => {
      if (!filename || !/\.(?:ts|js)$/.test(filename) || filename.endsWith('.d.ts')) return
      clearTimeout(this.timer)
      this.timer = setTimeout(() => void this.refresh(), 250)
    })
    this.watcher.on('error', (failure) => {
      this.state.error = failure.message
      this.publish()
    })
    this.watcher.unref()
    app.once('will-quit', () => this.destroy())
    return this.refresh()
  }

  private save(): void {
    writeFileSync(`${this.settingsFile}.tmp`, JSON.stringify(this.saved, null, 2), { mode: 0o600 })
    renameSync(`${this.settingsFile}.tmp`, this.settingsFile)
  }

  private publish(): void {
    for (const client of this.clients)
      if (!client.isDestroyed()) client.send('commands:changed', this.state)
  }

  async refresh(): Promise<CommandsState> {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.scan().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  private async scan(): Promise<CommandsState> {
    const files = new Map<string, CommandFile>()
    const commands: InstalledCommand[] = []
    try {
      const names = readdirSync(this.directory)
        .filter((name) => /\.(?:ts|js)$/.test(name) && !name.endsWith('.d.ts'))
        .sort()
      if (names.length > 100) throw new Error('Use at most 100 command files.')
      const removed = Object.keys(this.saved.commands).filter((id) => !names.includes(id))
      if (removed.length) {
        for (const id of removed) delete this.saved.commands[id]
        this.save()
      }
      for (const id of names) {
        if (this.disposed) return this.state
        let command: InstalledCommand = {
          id,
          name: id,
          command: id.replace(/\.(ts|js)$/, ''),
          description: '',
          intent: {},
          grants: [],
          enabled: false
        }
        try {
          const path = join(this.directory, id)
          const stat = lstatSync(path)
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024)
            throw new Error('Use a regular command file smaller than 128 KB.')
          const source = readFileSync(path, 'utf8')
          const hash = createHash('sha256').update(source).digest('hex')
          const previous = this.files.get(id)
          const metadata = previous?.hash === hash ? previous.command : await this.inspect(source)
          const saved = Object.hasOwn(this.saved.commands, id) ? this.saved.commands[id] : undefined
          command = {
            ...metadata,
            id,
            error: undefined,
            enabled:
              saved?.enabled === true &&
              Object.entries(metadata.intent).every(
                ([permission, reason]) => saved.grants?.[permission as CommandPermission] === reason
              ),
            grants: (Object.keys(metadata.intent) as CommandPermission[]).filter(
              (permission) => saved?.grants?.[permission] === metadata.intent[permission]
            )
          }
          files.set(id, { source, hash, command })
        } catch (failure) {
          command.error = failure instanceof Error ? failure.message : 'Invalid command.'
        }
        commands.push(command)
      }
      for (const command of commands)
        if (commands.some((other) => other !== command && other.command === command.command))
          command.error = `Duplicate /${command.command}. Rename or remove one command.`
      this.files = files
      this.state = { commands, error: '' }
    } catch (failure) {
      this.files.clear()
      this.state = {
        commands: [],
        error: failure instanceof Error ? failure.message : 'Could not read commands.'
      }
    }
    this.publish()
    return this.state
  }

  private async sandbox<T>(
    source: string,
    action: (contents: WebContents) => Promise<T>
  ): Promise<T> {
    const partition = session.fromPartition(`rei-command-${randomUUID()}`)
    partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    partition.setPermissionCheckHandler(() => false)
    partition.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !details.url.startsWith('data:') && details.url !== 'about:blank' })
    )
    const view = new WebContentsView({
      webPreferences: {
        session: partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(__dirname, '../preload/command.js'),
        webSecurity: true,
        backgroundThrottling: false
      }
    })
    const contents = view.webContents
    this.running.add(view)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-attach-webview', (event) => event.preventDefault())
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        (async () => {
          const document =
            "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'\"><title>Rei command sandbox</title>"
          await contents.loadURL(`data:text/html,${encodeURIComponent(document)}`)
          contents.on('will-navigate', (event) => event.preventDefault())
          const stripped = stripTypeScriptTypes(source)
            .replace(/^\s*import\s*\{\s*defineCommand\s*\}\s*from\s*['"]rei\/commands['"];?/m, '')
            .replace(/^\s*export\s+default\b/m, 'globalThis.__reiCommand =')
          await contents.executeJavaScript(commandSandboxBootstrap(stripped))
          return action(contents)
        })(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Command exceeded its 10 second execution limit.')),
            10000
          )
        })
      ])
    } finally {
      clearTimeout(timeout)
      this.running.delete(view)
      if (!contents.isDestroyed()) contents.close()
    }
  }

  private async inspect(source: string): Promise<InstalledCommand> {
    const metadata = await this.sandbox(source, (contents) =>
      contents.executeJavaScript('globalThis.__reiCommandMetadata')
    )
    return parseCommandMetadata(metadata)
  }

  async update(id: unknown, enabled: unknown, permission?: unknown): Promise<CommandsState> {
    await this.initialize()
    await this.refresh()
    if (typeof id !== 'string' || typeof enabled !== 'boolean')
      throw new Error('Invalid command setting.')
    const command = this.files.get(id)?.command
    if (!command || command.error) throw new Error('Command is unavailable. Fix its file first.')
    const current = Object.hasOwn(this.saved.commands, id)
      ? this.saved.commands[id]
      : { enabled: false, grants: {} }
    const saved: SavedCommand = { enabled: current.enabled === true, grants: { ...current.grants } }
    if (permission !== undefined) {
      if (typeof permission !== 'string' || !Object.hasOwn(command.intent, permission))
        throw new Error('Command did not request this permission.')
      const key = permission as CommandPermission
      if (enabled) saved.grants[key] = command.intent[key]
      else delete saved.grants[key]
    } else {
      saved.enabled = enabled
      if (enabled) saved.grants = { ...command.intent }
    }
    const previous = this.saved.commands[id]
    this.saved.commands[id] = saved
    try {
      this.save()
    } catch (failure) {
      if (previous) this.saved.commands[id] = previous
      else delete this.saved.commands[id]
      throw failure
    }
    return this.refresh()
  }

  async run(id: unknown, media: PlayingMedia | undefined, privateDownload = false): Promise<void> {
    await this.initialize()
    await this.refresh()
    const file = typeof id === 'string' ? this.files.get(id) : undefined
    if (!file) throw new Error('Command no longer exists.')
    const unavailable = commandUnavailable(file.command)
    if (unavailable) throw new Error(unavailable)
    await this.sandbox(file.source, async (contents) => {
      contents.ipc.handle('command:call', (event, permission: unknown, argument: unknown) => {
        if (event.senderFrame !== contents.mainFrame)
          throw new Error('Command frame access denied.')
        const current = this.files.get(file.command.id)
        const saved = this.saved.commands[file.command.id]
        if (!current || current.hash !== file.hash || commandUnavailable(current.command))
          throw new Error('Command changed or access was revoked.')
        if (
          !saved?.enabled ||
          Object.entries(current.command.intent).some(
            ([key, reason]) => saved.grants?.[key] !== reason
          )
        )
          throw new Error('Command access was revoked.')
        if (
          typeof permission !== 'string' ||
          !Object.hasOwn(file.command.intent, permission) ||
          !current.command.grants.includes(permission as CommandPermission)
        )
          throw new Error('Command permission denied.')
        if (permission === 'activeTab.media') {
          if (!media) throw new Error('Play a video or audio in this tab first.')
          return media
        }
        if (permission === 'downloads.enqueue') {
          if (
            !media ||
            !argument ||
            typeof argument !== 'object' ||
            !('id' in argument) ||
            argument.id !== media.id
          )
            throw new Error('Download only the media detected in this tab.')
          if (!current.command.grants.includes('activeTab.media'))
            throw new Error('Playing media access is required.')
          return enqueueMediaDownload(media, privateDownload)
        }
        throw new Error('Unknown command permission.')
      })
      const outcome = await contents.executeJavaScript('globalThis.__reiRunCommand()')
      if (typeof outcome?.error === 'string')
        throw new Error(
          outcome.error.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
        )
    })
  }

  register(
    contents: WebContents,
    trusted: (event: IpcMainInvokeEvent) => boolean,
    activePage: () => WebContents | undefined
  ): void {
    this.clients.add(contents)
    contents.once('destroyed', () => this.clients.delete(contents))
    const handle = (channel: string, callback: (...args: unknown[]) => unknown): void => {
      contents.ipc.handle(channel, (event, ...args: unknown[]) => {
        if (!trusted(event)) throw new Error('Command settings access denied.')
        return callback(...args)
      })
    }
    handle('commands:get', async () => {
      await this.initialize()
      return this.refresh()
    })
    handle('commands:enabled', (id, enabled) => this.update(id, enabled))
    handle('commands:permission', (id, permission, granted) => this.update(id, granted, permission))
    handle('commands:folder', async () => {
      mkdirSync(this.directory, { recursive: true })
      const error = await shell.openPath(this.directory)
      if (error) throw new Error(error)
    })
    handle('commands:reveal', async (id) => {
      await this.initialize()
      if (typeof id !== 'string' || !this.state.commands.some((command) => command.id === id))
        throw new Error('Unknown command.')
      shell.showItemInFolder(join(this.directory, id))
    })
    handle('commands:remove', async (id) => {
      await this.initialize()
      if (typeof id !== 'string' || !this.state.commands.some((command) => command.id === id))
        throw new Error('Unknown command.')
      await shell.trashItem(join(this.directory, id))
      delete this.saved.commands[id]
      this.save()
      return this.refresh()
    })
    handle('commands:run', (id) => {
      const page = activePage()
      const media = page && !page.isDestroyed() ? currentPlayingMedia(page) : undefined
      return this.run(id, media, !!page && !page.session.isPersistent())
    })
  }

  destroy(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.watcher?.close()
    for (const view of this.running) if (!view.webContents.isDestroyed()) view.webContents.close()
    this.running.clear()
  }
}

export function parseCommandMetadata(value: unknown): InstalledCommand {
  if (!value || typeof value !== 'object') throw new Error('Invalid command metadata.')
  const entry = value as Record<string, unknown>
  const text = (key: string, limit: number): string => {
    const value = entry[key]
    if (typeof value !== 'string' || !value.trim() || value.length > limit)
      throw new Error(`Invalid command ${key}.`)
    return value.trim()
  }
  const command = text('command', 32)
  if (!/^[a-z][a-z0-9-]*$/.test(command))
    throw new Error('Command names use lowercase letters, numbers, and hyphens.')
  if (!entry.intent || typeof entry.intent !== 'object' || Array.isArray(entry.intent))
    throw new Error('Declare requested access in intent.')
  const intent: CommandIntent = {}
  for (const [permission, reason] of Object.entries(entry.intent)) {
    if (!Object.hasOwn(commandPermissions, permission))
      throw new Error(`Unknown intent: ${permission}.`)
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 300)
      throw new Error('Each intent needs a short reason.')
    intent[permission as CommandPermission] = reason.trim()
  }
  return {
    id: '',
    name: text('name', 80),
    command,
    description: text('description', 300),
    ...(entry.version === undefined ? {} : { version: text('version', 40) }),
    intent,
    enabled: false,
    grants: []
  }
}

let runtime: CommandRuntime | undefined
export function commandsRuntime(): CommandRuntime {
  runtime ??= new CommandRuntime()
  return runtime
}
