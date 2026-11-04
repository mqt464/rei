import { app, ipcMain, webContents } from 'electron'
import type {
  IpcMainEvent,
  IpcMainInvokeEvent,
  IpcMainServiceWorkerEvent,
  IpcMainServiceWorkerInvokeEvent,
  ProxyConfig,
  Session,
  WebFrameMain,
  ServiceWorkerMain
} from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'

type ProxyEvent =
  IpcMainEvent | IpcMainInvokeEvent | IpcMainServiceWorkerEvent | IpcMainServiceWorkerInvokeEvent
type Policy = Parameters<Electron.WebContents['setWebRTCIPHandlingPolicy']>[0]
interface Server {
  scheme?: string
  host: string
  port?: number
}
interface ProxyValue {
  mode: 'system' | 'direct' | 'auto_detect' | 'pac_script' | 'fixed_servers'
  pacScript?: { data?: string; url?: string; mandatory?: boolean }
  rules?: {
    singleProxy?: Server
    proxyForHttp?: Server
    proxyForHttps?: Server
    proxyForFtp?: Server
    fallbackProxy?: Server
    bypassList?: string[]
  }
}
interface Grant {
  proxy?: ProxyValue
  webRTC?: Policy
}
interface SavedProxy {
  order: string[]
  grants: Record<string, Grant>
}
interface Subscriber {
  id: string
  source: WebFrameMain | ServiceWorkerMain
  name: string
  worker: boolean
}

function serverRule(server: Server): string {
  const scheme = server.scheme ?? 'http'
  if (!['http', 'https', 'socks4', 'socks5'].includes(scheme))
    throw new Error('Unsupported proxy scheme.')
  if (
    typeof server.host !== 'string' ||
    !server.host ||
    (!isIP(server.host) && !/^[a-z0-9.-]+$/i.test(server.host))
  )
    throw new Error('Invalid proxy host.')
  const port = server.port ?? (scheme === 'https' ? 443 : scheme.startsWith('socks') ? 1080 : 80)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid proxy port.')
  return `${scheme}://${isIP(server.host) === 6 ? `[${server.host}]` : server.host}:${port}`
}

export function extensionProxyConfig(value: ProxyValue): ProxyConfig {
  if (
    !value ||
    !['system', 'direct', 'auto_detect', 'pac_script', 'fixed_servers'].includes(value.mode)
  )
    throw new Error('Invalid proxy mode.')
  if (value.mode === 'pac_script') {
    const pac = value.pacScript
    if (!pac || pac.mandatory)
      throw new Error('Mandatory PAC scripts are not supported by this runtime.')
    if (
      typeof pac.data === 'string' &&
      pac.data.length > 0 &&
      pac.data.length <= 1024 * 1024 &&
      !pac.url
    )
      return {
        mode: value.mode,
        pacScript: `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pac.data).toString('base64')}`
      }
    if (typeof pac.url === 'string' && !pac.data) {
      const url = new URL(pac.url)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
        return { mode: value.mode, pacScript: url.href }
    }
    throw new Error('Invalid PAC script.')
  }
  if (value.mode !== 'fixed_servers') return { mode: value.mode }
  const rules = value.rules
  if (!rules) throw new Error('Missing proxy rules.')
  const perScheme = [
    ['http', rules.proxyForHttp],
    ['https', rules.proxyForHttps],
    ['ftp', rules.proxyForFtp],
    ['socks', rules.fallbackProxy]
  ] as const
  if (rules.singleProxy && perScheme.some(([, server]) => server))
    throw new Error('Conflicting proxy rules.')
  const proxyRules = rules.singleProxy
    ? serverRule(rules.singleProxy)
    : perScheme
        .filter(([, server]) => server)
        .map(([scheme, server]) => `${scheme}=${serverRule(server!)}`)
        .join(';')
  if (!proxyRules) throw new Error('Missing proxy server.')
  if (
    rules.bypassList !== undefined &&
    (!Array.isArray(rules.bypassList) ||
      !rules.bypassList.every((entry) => typeof entry === 'string' && !/[;\r\n]/.test(entry)))
  )
    throw new Error('Invalid proxy bypass list.')
  return { mode: value.mode, proxyRules, proxyBypassRules: rules.bypassList?.join(';') }
}

export class ExtensionProxy {
  private readonly path = join(app.getPath('userData'), 'extension-proxy.json')
  private saved: SavedProxy = { order: [], grants: {} }
  private pending = Promise.resolve()
  private failure?: Error
  private readonly notified = new Map<string, string>()
  private readonly subscribers = new Set<Subscriber>()
  private readonly attachedWorkers = new WeakSet<ServiceWorkerMain>()
  private readonly runningWorkers = new Set<number>()
  private readonly challenges = new Map<
    string,
    { owner: string; deliver(): boolean; finish(username?: string, password?: string): void }
  >()
  private activeProxy = ''
  private activePolicy: Policy = 'default'
  private activeOwner = ''

  constructor(private readonly session: Session) {
    if (existsSync(this.path)) {
      const saved = JSON.parse(readFileSync(this.path, 'utf8')) as SavedProxy
      if (
        !Array.isArray(saved.order) ||
        !saved.order.every((id) => typeof id === 'string' && /^[a-p]{32}$/.test(id)) ||
        new Set(saved.order).size !== saved.order.length ||
        !saved.grants ||
        typeof saved.grants !== 'object' ||
        Array.isArray(saved.grants)
      )
        throw new Error('Invalid saved extension proxy settings.')
      for (const [id, grant] of Object.entries(saved.grants)) {
        if (!/^[a-p]{32}$/.test(id) || !saved.order.includes(id))
          throw new Error('Invalid saved proxy controller.')
        if (!grant || typeof grant !== 'object' || Array.isArray(grant))
          throw new Error('Invalid saved proxy grant.')
        if (grant.proxy !== undefined) extensionProxyConfig(grant.proxy)
        if (grant.webRTC !== undefined) this.validatePolicy(grant.webRTC)
      }
      this.saved = saved
    }
    ipcMain.handle('rei-extension-proxy', this.request.bind(this))
    ipcMain.on('rei-extension-proxy-subscribe', this.subscribe.bind(this))
    session.serviceWorkers.on('running-status-changed', (details) => {
      if (details.runningStatus === 'running') {
        this.runningWorkers.add(details.versionId)
        for (const challenge of this.challenges.values()) challenge.deliver()
      }
      if (details.runningStatus === 'stopping' || details.runningStatus === 'stopped') {
        this.runningWorkers.delete(details.versionId)
        for (const entry of this.subscribers)
          if (entry.worker && (entry.source as ServiceWorkerMain).versionId === details.versionId)
            this.subscribers.delete(entry)
      }
      if (details.runningStatus !== 'starting') return
      const worker = session.serviceWorkers.getWorkerFromVersionID(details.versionId)
      if (!worker?.scope.startsWith('chrome-extension://') || this.attachedWorkers.has(worker))
        return
      this.attachedWorkers.add(worker)
      worker.ipc.handle('rei-extension-proxy', this.request.bind(this))
      worker.ipc.on('rei-extension-proxy-subscribe', this.subscribe.bind(this))
    })
    session.extensions.on('extension-loaded', (_event, extension) => {
      void this.enqueue(async () => {
        if (!this.saved.order.includes(extension.id)) this.saved.order.push(extension.id)
        await this.apply(this.saved)
      }).catch(() => console.error('Could not restore extension proxy settings.'))
    })
    session.extensions.on('extension-unloaded', (_event, extension) => {
      this.notified.delete(`${extension.id}:proxy`)
      this.notified.delete(`${extension.id}:webRTC`)
      for (const subscriber of this.subscribers)
        if (subscriber.id === extension.id) this.subscribers.delete(subscriber)
      void this.enqueue(() => this.apply(this.saved)).catch(() =>
        console.error('Could not release extension proxy settings.')
      )
    })
    app.on('web-contents-created', (_event, contents) => {
      if (contents.session === session) contents.setWebRTCIPHandlingPolicy(this.activePolicy)
    })
    app.on('login', (event, contents, details, info, callback) => {
      if (!info.isProxy || !this.activeOwner) return
      const workerRequest =
        !contents &&
        Object.values(session.serviceWorkers.getAllRunning()).some(
          (worker) => worker.renderProcessId === details.pid
        )
      if (contents ? contents.session !== session : !workerRequest) return
      event.preventDefault()
      if (!details.firstAuthAttempt) {
        callback()
        return
      }
      const owner = this.activeOwner
      if (
        !session.extensions
          .getExtension(owner)
          ?.manifest.permissions?.includes('webRequestAuthProvider')
      ) {
        callback()
        return
      }
      const requestId = randomUUID()
      const finish = (username?: string, password?: string): void => {
        if (!this.challenges.delete(requestId)) return
        clearTimeout(timer)
        callback(username, password)
      }
      const timer = setTimeout(() => finish(), 25000)
      const authDetails = {
        requestId,
        url: details.url,
        isProxy: true,
        scheme: info.scheme,
        realm: info.realm,
        challenger: { host: info.host, port: info.port },
        tabId: contents?.id ?? -1,
        frameId: 0,
        parentFrameId: -1,
        type: 'other',
        timeStamp: Date.now()
      }
      let sent = false
      const deliver = (): boolean => {
        if (sent || !this.challenges.has(requestId)) return true
        sent = this.dispatch(owner, 'rei.proxy.onAuthRequired', authDetails) > 0
        return sent
      }
      this.challenges.set(requestId, { owner, finish, deliver })
      if (!deliver()) {
        const extension = session.extensions.getExtension(owner)
        if (extension?.manifest.background?.service_worker)
          void session.serviceWorkers.startWorkerForScope(extension.url).then(
            () => {
              deliver()
            },
            () => finish()
          )
        else finish()
      }
    })
    app.on('before-quit', () => this.cancelChallenges())
  }

  async whenReady(): Promise<void> {
    await this.pending
    if (this.failure) throw this.failure
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.pending.then(operation)
    this.pending = result.catch(() => {})
    return result
  }

  private identity(event: ProxyEvent, claimed: unknown, permission: string): string {
    const eventSession = event.type === 'frame' ? event.sender.session : event.session
    const url = event.type === 'frame' ? event.senderFrame?.url : event.serviceWorker.scope
    if (
      eventSession !== this.session ||
      typeof claimed !== 'string' ||
      !url?.startsWith(`chrome-extension://${claimed}/`)
    )
      throw new Error('Extension proxy access denied.')
    if (!this.session.extensions.getExtension(claimed)?.manifest.permissions?.includes(permission))
      throw new Error(`Extension requires ${permission} permission.`)
    return claimed
  }

  private subscribe(event: ProxyEvent, id: unknown, name: string): void {
    try {
      if (
        !['rei.proxy.onChange', 'rei.proxy.onAuthRequired', 'rei.proxy.onWebRTCChange'].includes(
          name
        )
      )
        return
      const owner = this.identity(
        event,
        id,
        name === 'rei.proxy.onWebRTCChange' ? 'privacy' : 'proxy'
      )
      if (name === 'rei.proxy.onAuthRequired') {
        this.identity(event, id, 'webRequestAuthProvider')
        this.identity(event, id, 'webRequest')
      }
      const source = event.type === 'frame' ? event.senderFrame : event.serviceWorker
      if (!source) return
      if (![...this.subscribers].some((entry) => entry.source === source && entry.name === name))
        this.subscribers.add({ id: owner, source, name, worker: event.type !== 'frame' })
    } catch {
      return
    }
  }

  private dispatch(id: string, name: string, details: unknown): number {
    let sent = 0
    for (const entry of this.subscribers) {
      if (entry.id !== id || entry.name !== name) continue
      try {
        if (entry.worker) {
          const worker = entry.source as ServiceWorkerMain
          if (worker.isDestroyed()) throw new Error('Worker closed.')
          if (!this.runningWorkers.has(worker.versionId)) continue
          worker.send(`crx-${name}`, details)
        } else {
          const frame = entry.source as WebFrameMain
          if (frame.detached || !frame.url.startsWith(`chrome-extension://${id}/`))
            throw new Error('Frame navigated.')
          frame.send(`crx-${name}`, details)
        }
        sent++
      } catch {
        this.subscribers.delete(entry)
      }
    }
    return sent
  }

  private owner(key: keyof Grant, saved = this.saved): string {
    const permission = key === 'proxy' ? 'proxy' : 'privacy'
    return (
      [...saved.order]
        .reverse()
        .find(
          (id) =>
            saved.grants[id]?.[key] !== undefined &&
            this.session.extensions.getExtension(id)?.manifest.permissions?.includes(permission)
        ) ?? ''
    )
  }

  private state(id: string, key: keyof Grant, saved = this.saved): object {
    const owner = this.owner(key, saved)
    return {
      value: owner ? saved.grants[owner][key] : key === 'proxy' ? { mode: 'system' } : 'default',
      levelOfControl:
        owner === id
          ? 'controlled_by_this_extension'
          : owner && saved.order.indexOf(owner) > saved.order.indexOf(id)
            ? 'controlled_by_other_extensions'
            : 'controllable_by_this_extension'
    }
  }

  private cancelChallenges(): void {
    for (const challenge of this.challenges.values()) challenge.finish()
  }

  private async apply(saved: SavedProxy): Promise<void> {
    try {
      await this.applySettings(saved)
      this.failure = undefined
    } catch (error) {
      this.activeProxy = ''
      this.failure = error instanceof Error ? error : new Error('Could not apply proxy settings.')
      throw this.failure
    }
  }

  private async applySettings(saved: SavedProxy): Promise<void> {
    const owner = this.owner('proxy', saved)
    const config = extensionProxyConfig(owner ? saved.grants[owner].proxy! : { mode: 'system' })
    const serialized = JSON.stringify(config)
    if (serialized !== this.activeProxy || owner !== this.activeOwner) {
      this.cancelChallenges()
      await this.session.clearAuthCache()
      await this.session.setProxy(config)
      await this.session.closeAllConnections()
      this.activeProxy = serialized
      this.activeOwner = owner
    }
    const policyOwner = this.owner('webRTC', saved)
    const policy = policyOwner ? saved.grants[policyOwner].webRTC! : 'default'
    if (policy !== this.activePolicy) {
      for (const contents of webContents.getAllWebContents())
        if (contents.session === this.session) contents.setWebRTCIPHandlingPolicy(policy)
      this.activePolicy = policy
    }
    for (const extension of this.session.extensions.getAllExtensions()) {
      for (const key of ['proxy', 'webRTC'] as const) {
        const state = this.state(extension.id, key, saved)
        const cacheKey = `${extension.id}:${key}`
        const serializedState = JSON.stringify(state)
        if (this.notified.get(cacheKey) === serializedState) continue
        this.notified.set(cacheKey, serializedState)
        this.dispatch(
          extension.id,
          key === 'proxy' ? 'rei.proxy.onChange' : 'rei.proxy.onWebRTCChange',
          state
        )
      }
    }
  }

  private validatePolicy(policy: unknown): asserts policy is Policy {
    if (
      ![
        'default',
        'default_public_interface_only',
        'default_public_and_private_interfaces',
        'disable_non_proxied_udp'
      ].includes(policy as string)
    )
      throw new Error('Invalid WebRTC IP handling policy.')
  }

  async remove(id: string): Promise<void> {
    await this.enqueue(async () => {
      const saved = structuredClone(this.saved)
      delete saved.grants[id]
      saved.order = saved.order.filter((entry) => entry !== id)
      await this.commit(saved)
    })
  }

  private async commit(saved: SavedProxy): Promise<void> {
    try {
      await this.apply(saved)
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(`${this.path}.tmp`, JSON.stringify(saved), { mode: 0o600 })
      renameSync(`${this.path}.tmp`, this.path)
      this.saved = saved
    } catch (error) {
      await this.apply(this.saved)
      throw error
    }
  }

  async request(
    event: ProxyEvent,
    claimed: unknown,
    method: string,
    details: Record<string, unknown> = {}
  ): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    try {
      const privacy = method.startsWith('rei.proxy.webRTC.')
      const id = this.identity(event, claimed, privacy ? 'privacy' : 'proxy')
      if (!details || typeof details !== 'object' || Array.isArray(details))
        throw new Error('Invalid proxy settings request.')
      if (
        details.incognito ||
        (details.scope !== undefined &&
          !['regular', 'regular_only'].includes(details.scope as string))
      )
        throw new Error('Incognito proxy settings are not supported.')
      if (method === 'rei.proxy.authListen') {
        this.identity(event, claimed, 'webRequestAuthProvider')
        this.identity(event, claimed, 'webRequest')
        if (details.enabled) {
          this.subscribe(event, id, 'rei.proxy.onAuthRequired')
          for (const challenge of this.challenges.values())
            if (challenge.owner === id) challenge.deliver()
        } else {
          const source = event.type === 'frame' ? event.senderFrame : event.serviceWorker
          for (const entry of this.subscribers)
            if (entry.source === source && entry.name === 'rei.proxy.onAuthRequired')
              this.subscribers.delete(entry)
        }
        return { ok: true }
      }
      if (method === 'rei.proxy.authResponse') {
        this.identity(event, claimed, 'webRequestAuthProvider')
        const challenge = this.challenges.get(details.requestId as string)
        if (!challenge || challenge.owner !== id || this.activeOwner !== id)
          throw new Error('Proxy authentication request expired.')
        const response = details.response as
          | { cancel?: boolean; authCredentials?: { username?: unknown; password?: unknown } }
          | undefined
        const credentials = response?.authCredentials
        if (
          !response?.cancel &&
          typeof credentials?.username === 'string' &&
          typeof credentials.password === 'string'
        )
          challenge.finish(credentials.username, credentials.password)
        else challenge.finish()
        return { ok: true }
      }
      const key = privacy ? 'webRTC' : 'proxy'
      const operation = method.slice(privacy ? 'rei.proxy.webRTC.'.length : 'rei.proxy.'.length)
      if (operation === 'get') {
        await this.whenReady()
        return { ok: true, value: this.state(id, key) }
      }
      if (!['set', 'clear'].includes(operation)) throw new Error('Unknown proxy operation.')
      if (operation === 'set') {
        if (privacy) this.validatePolicy(details.value)
        else extensionProxyConfig(details.value as ProxyValue)
      }
      await this.enqueue(async () => {
        this.identity(event, claimed, privacy ? 'privacy' : 'proxy')
        const saved = structuredClone(this.saved)
        if (!saved.order.includes(id)) saved.order.push(id)
        const grant = (saved.grants[id] ??= {})
        if (operation === 'clear') delete grant[key]
        else if (privacy) grant.webRTC = details.value as Policy
        else grant.proxy = structuredClone(details.value) as ProxyValue
        await this.commit(saved)
      })
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Extension proxy request failed.'
      }
    }
  }
}
