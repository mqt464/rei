import { app, dialog } from 'electron'
import type { BaseWindow, IpcMainInvokeEvent, Session, WebContents } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { websitePermissionLabels } from '../shared/website-permissions'
import type { WebsitePermission, WebsitePermissionDecision } from '../shared/website-permissions'

interface PermissionState {
  decisions: Map<string, WebsitePermissionDecision>
  pending: Set<() => void>
  private: boolean
}

const sessions = new WeakMap<Session, PermissionState>()
const owners = new WeakMap<WebContents, BaseWindow>()
const prompting = new WeakSet<BaseWindow>()
const clients = new Set<WebContents>()
let saved: Map<string, WebsitePermissionDecision> | undefined

function originOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin
  } catch {
    return undefined
  }
  return undefined
}

function keyOf(decision: Omit<WebsitePermissionDecision, 'allowed'>): string {
  return JSON.stringify([decision.topOrigin, decision.origin, decision.permission])
}

function savedDecisions(): Map<string, WebsitePermissionDecision> {
  if (saved) return saved
  saved = new Map()
  const path = join(app.getPath('userData'), 'website-permissions.json')
  if (!existsSync(path)) return saved
  try {
    const values: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(values)) throw new Error('Invalid website permissions.')
    for (const value of values) {
      if (
        value &&
        typeof value.origin === 'string' &&
        typeof value.topOrigin === 'string' &&
        typeof value.permission === 'string' &&
        originOf(value.origin) === value.origin &&
        originOf(value.topOrigin) === value.topOrigin &&
        Object.hasOwn(websitePermissionLabels, value.permission) &&
        typeof value.allowed === 'boolean'
      ) {
        const decision: WebsitePermissionDecision = {
          origin: value.origin,
          topOrigin: value.topOrigin,
          permission: value.permission,
          allowed: value.allowed
        }
        saved.set(keyOf(decision), decision)
      }
    }
  } catch (error) {
    console.error('Could not read website permissions:', error)
  }
  return saved
}

function persist(decisions: Map<string, WebsitePermissionDecision>): void {
  const directory = app.getPath('userData')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'website-permissions.json')
  writeFileSync(`${path}.tmp`, JSON.stringify([...decisions.values()], null, 2), { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
  const current = savedDecisions()
  current.clear()
  for (const [key, decision] of decisions) current.set(key, decision)
  for (const contents of clients)
    if (!contents.isDestroyed()) contents.send('website-permissions:changed')
}

function permissionsFor(permission: string, mediaTypes: string[] = []): WebsitePermission[] {
  if (permission === 'media') {
    if (!mediaTypes.length || mediaTypes.some((type) => type !== 'video' && type !== 'audio'))
      return []
    return [...new Set(mediaTypes.map((type) => (type === 'video' ? 'camera' : 'microphone')))]
  }
  if (permission === 'geolocation' || permission === 'geolocation-approximate') return ['location']
  if (permission === 'notifications') return ['notifications']
  if (permission === 'clipboard-read' || permission === 'deprecated-sync-clipboard-read')
    return ['clipboard-read']
  if (permission === 'clipboard-sanitized-write') return ['clipboard-write']
  return []
}

export function clearPrivateWebsitePermissions(session: Session): void {
  const state = sessions.get(session)
  if (!state?.private) return
  for (const cancel of state.pending) cancel()
  state.decisions.clear()
}

export function registerWebsitePermissions(
  contents: WebContents,
  window: BaseWindow,
  incognito: boolean
): void {
  owners.set(contents, window)
  const session = contents.session
  if (sessions.has(session)) return
  const state: PermissionState = {
    decisions: incognito ? new Map() : savedDecisions(),
    pending: new Set(),
    private: incognito
  }
  sessions.set(session, state)

  session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (
      !contents ||
      contents.isDestroyed() ||
      contents.session !== session ||
      !owners.has(contents)
    )
      return false
    if (permission === 'fullscreen') return contents.isFocused()
    const origin = originOf(details.securityOrigin ?? details.requestingUrl ?? requestingOrigin)
    const topOrigin = originOf(contents.getURL())
    const permissions = permissionsFor(permission, details.mediaType ? [details.mediaType] : [])
    return (
      !!origin &&
      !!topOrigin &&
      permissions.length > 0 &&
      permissions.every(
        (permission) =>
          state.decisions.get(keyOf({ origin, topOrigin, permission }))?.allowed === true
      )
    )
  })

  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!contents || contents.isDestroyed() || contents.session !== session) {
      callback(false)
      return
    }
    const window = owners.get(contents)
    if (permission === 'fullscreen') {
      callback(!!window && !window.isDestroyed() && contents.isFocused())
      return
    }
    const origin = originOf(
      'securityOrigin' in details && details.securityOrigin !== undefined
        ? details.securityOrigin
        : details.requestingUrl
    )
    const topOrigin = contents.isDestroyed() ? undefined : originOf(contents.getURL())
    const permissions = permissionsFor(
      permission,
      'mediaTypes' in details ? details.mediaTypes : []
    )
    if (!window || window.isDestroyed() || !origin || !topOrigin || !permissions.length) {
      callback(false)
      return
    }
    const decisions = permissions.map((permission) => ({ origin, topOrigin, permission }))
    if (decisions.some((decision) => state.decisions.get(keyOf(decision))?.allowed === false)) {
      callback(false)
      return
    }
    if (decisions.every((decision) => state.decisions.get(keyOf(decision))?.allowed === true)) {
      callback(true)
      return
    }
    if (!contents.isFocused() || prompting.has(window)) {
      callback(false)
      return
    }
    prompting.add(window)
    const controller = new AbortController()
    let finished = false
    const finish = (allowed: boolean): void => {
      if (finished) return
      finished = true
      state.pending.delete(cancel)
      contents.removeListener('did-start-navigation', cancel)
      contents.removeListener('destroyed', cancel)
      contents.removeListener('render-process-gone', cancel)
      window.removeListener('closed', cancel)
      callback(allowed)
    }
    const cancel = (): void => {
      finish(false)
      controller.abort()
    }
    state.pending.add(cancel)
    contents.once('did-start-navigation', cancel)
    contents.once('destroyed', cancel)
    contents.once('render-process-gone', cancel)
    window.once('closed', cancel)
    const labels = decisions
      .map((decision) => websitePermissionLabels[decision.permission])
      .join(', ')
    void dialog
      .showMessageBox(window, {
        type: 'question',
        signal: controller.signal,
        title: 'Website permission',
        message: `${origin} wants access to: ${labels}`,
        detail: [
          origin !== topOrigin ? `Embedded in ${topOrigin}.` : '',
          incognito
            ? 'Incognito decisions are temporary.'
            : 'Manage saved choices in Settings > Privacy > Site permissions.'
        ]
          .filter(Boolean)
          .join('\n\n'),
        buttons: ['Block', 'Allow', 'Not now'],
        defaultId: 0,
        cancelId: 2,
        ...(incognito ? {} : { checkboxLabel: 'Remember for this site', checkboxChecked: false }),
        noLink: true
      })
      .then(({ response, checkboxChecked }) => {
        if (finished) return
        if (
          contents.isDestroyed() ||
          window.isDestroyed() ||
          originOf(contents.getURL()) !== topOrigin
        ) {
          finish(false)
          return
        }
        if (response !== 0 && response !== 1) {
          finish(false)
          return
        }
        const allowed = response === 1
        if (incognito || checkboxChecked) {
          const next = new Map(state.decisions)
          for (const decision of decisions) next.set(keyOf(decision), { ...decision, allowed })
          if (incognito) state.decisions = next
          else persist(next)
        }
        finish(allowed)
      })
      .catch((error) => {
        console.error('Could not resolve website permission:', error)
        finish(false)
      })
      .finally(() => prompting.delete(window))
  })
}

export function registerWebsitePermissionSettings(
  contents: WebContents,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  activeContents: () => WebContents | undefined = () => undefined
): void {
  function context(scope: unknown): { state?: PermissionState; origin?: string } {
    if (scope === undefined) return {}
    if (
      !scope ||
      typeof scope !== 'object' ||
      !('contentsId' in scope) ||
      !Number.isSafeInteger(scope.contentsId)
    )
      throw new Error('Invalid permission scope.')
    const active = activeContents()
    if (!active || active.isDestroyed()) throw new Error('Site is no longer open.')
    if (scope.contentsId !== active.id) throw new Error('Site has changed. Reopen permissions.')
    const origin = originOf(active.getURL())
    const state = sessions.get(active.session)
    if (!origin || !state) throw new Error('Site permissions unavailable.')
    return { state, origin }
  }

  function list(state?: PermissionState, origin?: string): WebsitePermissionDecision[] {
    return [...(state?.decisions ?? savedDecisions()).values()].filter(
      (decision) => !origin || decision.topOrigin === origin
    )
  }

  clients.add(contents)
  contents.once('destroyed', () => clients.delete(contents))
  contents.ipc.handle('website-permissions:get', (event, scope: unknown) => {
    if (!trusted(event)) throw new Error('Website permission access denied.')
    const { state, origin } = context(scope)
    return list(state, origin)
  })
  contents.ipc.handle('website-permissions:reset', (event, value: unknown, scope: unknown) => {
    if (!trusted(event)) throw new Error('Website permission access denied.')
    if (!value || typeof value !== 'object') throw new Error('Invalid website permission.')
    const decision = value as WebsitePermissionDecision
    if (
      typeof decision.origin !== 'string' ||
      typeof decision.topOrigin !== 'string' ||
      typeof decision.permission !== 'string' ||
      originOf(decision.origin) !== decision.origin ||
      originOf(decision.topOrigin) !== decision.topOrigin ||
      !Object.hasOwn(websitePermissionLabels, decision.permission)
    )
      throw new Error('Invalid website permission.')
    const { state, origin } = context(scope)
    if (origin && decision.topOrigin !== origin)
      throw new Error('Site has changed. Reopen permissions.')
    const next = new Map(state?.decisions ?? savedDecisions())
    next.delete(keyOf(decision))
    if (state?.private) state.decisions = next
    else persist(next)
    return list(state, origin)
  })
}
