const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-permissions-check-'))
const savedPath = path.join(profile, 'website-permissions.json')
const prompts = []
let answer = { response: 1, checkboxChecked: true }
let pendingAnswer
let nextContentsId = 0

function loadModule(relative, electron) {
  const filename = path.resolve(__dirname, relative)
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const originalRequire = loaded.require.bind(loaded)
  loaded.require = (name) => {
    if (name === 'electron') return electron
    if (name === '../shared/website-permissions')
      return loadModule('../src/shared/website-permissions.ts', electron)
    return originalRequire(name)
  }
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    filename
  )
  return loaded.exports
}

const electron = {
  app: { getPath: () => profile },
  dialog: {
    showMessageBox: async (window, options) => {
      prompts.push(options)
      if (answer === 'pending')
        return new Promise((resolve) => {
          pendingAnswer = resolve
        })
      if (answer instanceof Error) throw answer
      return answer
    }
  }
}

function fixture(api, incognito = false, session) {
  const window = new EventEmitter()
  window.isDestroyed = () => false
  const contents = new EventEmitter()
  contents.id = ++nextContentsId
  contents.url = 'https://site.test/page'
  contents.getURL = () => contents.url
  contents.isDestroyed = () => false
  contents.isFocused = () => true
  contents.session = session ?? {
    setPermissionRequestHandler(handler) {
      this.request = handler
    },
    setPermissionCheckHandler(handler) {
      this.check = handler
    }
  }
  api.registerWebsitePermissions(contents, window, incognito)
  return { contents, window, session: contents.session }
}

const details = (patch = {}) => ({
  requestingUrl: 'https://site.test/page',
  isMainFrame: true,
  ...patch
})
const settle = () => new Promise((resolve) => setImmediate(resolve))
async function request(target, permission, patch = {}) {
  const results = []
  target.session.request(
    target.contents,
    permission,
    (value) => results.push(value),
    details(patch)
  )
  await settle()
  return results
}
function check(target, permission, patch = {}, origin = 'https://site.test') {
  return target.session.check(target.contents, permission, origin, details(patch))
}

async function run() {
  const api = loadModule('../src/main/website-permissions.ts', electron)
  const normal = fixture(api)
  assert.equal(check(normal, 'notifications'), false)
  for (const [permission, patch, checkPatch] of [
    ['media', { mediaTypes: ['video', 'audio'] }, { mediaType: 'video' }],
    ['geolocation', {}, {}],
    ['notifications', {}, {}],
    ['clipboard-read', {}, {}],
    ['clipboard-sanitized-write', {}, {}]
  ]) {
    assert.deepEqual(await request(normal, permission, patch), [true])
    assert.equal(check(normal, permission, checkPatch), true)
  }
  assert.equal(check(normal, 'media', { mediaType: 'audio' }), true)
  assert.equal(check(normal, 'media', { mediaType: 'unknown' }), false)
  assert.equal(check(normal, 'deprecated-sync-clipboard-read'), true)
  assert.equal(check(normal, 'geolocation-approximate'), true)
  assert.equal(prompts[0].defaultId, 0)
  assert.equal(prompts[0].cancelId, 2)
  assert.match(prompts[0].message, /https:\/\/site.test.*Camera, Microphone/)
  const promptCount = prompts.length
  assert.deepEqual(await request(normal, 'media', { mediaTypes: ['video', 'audio'] }), [true])
  for (const permission of ['usb', 'display-capture', 'fullscreen', 'unknown']) {
    assert.deepEqual(await request(normal, permission), [false])
    assert.equal(check(normal, permission), false)
  }
  assert.deepEqual(await request(normal, 'media'), [false])
  assert.deepEqual(await request(normal, 'media', { mediaTypes: ['unknown'] }), [false])
  assert.deepEqual(
    await request(normal, 'notifications', { requestingUrl: 'data:text/html,test' }),
    [false]
  )
  assert.deepEqual(
    await request(normal, 'media', { mediaTypes: ['video'], securityOrigin: 'null' }),
    [false]
  )
  assert.equal(prompts.length, promptCount)
  for (const origin of ['https://other.test', 'http://site.test', 'https://site.test:8443'])
    assert.equal(check(normal, 'notifications', { requestingUrl: `${origin}/` }, origin), false)
  assert.equal(
    check(normal, 'media', { mediaType: 'video', securityOrigin: 'https://other.test' }),
    false
  )
  assert.equal(normal.session.check(null, 'notifications', 'https://site.test', details()), false)
  const foreign = fixture(api)
  assert.equal(
    normal.session.check(foreign.contents, 'notifications', 'https://site.test', details()),
    false
  )
  const unregistered = { isDestroyed: () => false, getURL: () => 'https://site.test' }
  assert.equal(
    normal.session.check(unregistered, 'notifications', 'https://site.test', details()),
    false
  )

  const embedded = { requestingUrl: 'https://frame.test/embedded', isMainFrame: false }
  assert.deepEqual(await request(normal, 'notifications', embedded), [true])
  assert.match(prompts.at(-1).message, /https:\/\/frame.test/)
  assert.match(prompts.at(-1).detail, /Embedded in https:\/\/site.test/)
  normal.contents.url = 'https://other.test/'
  assert.equal(check(normal, 'notifications', embedded, 'https://frame.test'), false)
  normal.contents.url = 'https://site.test/page'

  const secondWindow = fixture(api, false, normal.session)
  assert.equal(check(secondWindow, 'notifications'), true)
  const reloadedApi = loadModule('../src/main/website-permissions.ts', electron)
  assert.equal(check(fixture(reloadedApi), 'notifications'), true)

  const privateTab = fixture(api, true)
  const beforePrivate = fs.readFileSync(savedPath, 'utf8')
  assert.equal(check(privateTab, 'notifications'), false)
  answer = { response: 0, checkboxChecked: true }
  assert.deepEqual(await request(privateTab, 'notifications'), [false])
  const afterPrivateBlock = prompts.length
  assert.deepEqual(await request(privateTab, 'notifications'), [false])
  assert.equal(prompts.length, afterPrivateBlock)
  answer = { response: 1, checkboxChecked: true }
  assert.deepEqual(await request(privateTab, 'geolocation'), [true])
  assert.equal(check(privateTab, 'geolocation'), true)
  assert.equal(check(fixture(api, true, privateTab.session), 'geolocation'), true)
  assert.equal(check(fixture(api, true), 'geolocation'), false)
  assert.equal('checkboxLabel' in prompts.at(-1), false)
  assert.equal(fs.readFileSync(savedPath, 'utf8'), beforePrivate)
  api.clearPrivateWebsitePermissions(privateTab.session)
  assert.equal(check(privateTab, 'geolocation'), false)
  assert.equal(check(normal, 'notifications'), true)

  const ipc = new Map()
  const ui = new EventEmitter()
  ui.ipc = { handle: (channel, handler) => ipc.set(channel, handler) }
  ui.isDestroyed = () => false
  ui.send = () => {}
  let active = normal.contents
  api.registerWebsitePermissionSettings(
    ui,
    (event) => event.trusted,
    () => active
  )
  const get = ipc.get('website-permissions:get')
  const reset = ipc.get('website-permissions:reset')
  assert.throws(() => get({ trusted: false }), /denied/)
  assert.throws(() => reset({ trusted: false }, {}), /denied/)
  assert.throws(() => reset({ trusted: true }, { permission: 'camera' }), /Invalid/)
  const saved = get({ trusted: true })
  assert.equal(get({ trusted: true }, { contentsId: normal.contents.id }).length, 7)
  assert.throws(() => get({ trusted: true }, 'site'), /Invalid/)
  assert.throws(() => get({ trusted: true }, { contentsId: privateTab.contents.id }), /changed/)
  assert.equal(saved.length, 7)
  assert.equal(
    saved.some((decision) => !decision.allowed),
    false
  )
  const camera = saved.find((decision) => decision.permission === 'camera')
  reset({ trusted: true }, camera)
  assert.equal(check(normal, 'media', { mediaType: 'video' }), false)
  assert.equal(check(secondWindow, 'media', { mediaType: 'video' }), false)
  assert.equal(check(normal, 'media', { mediaType: 'audio' }), true)

  answer = { response: 0, checkboxChecked: true }
  assert.deepEqual(await request(normal, 'media', { mediaTypes: ['video', 'audio'] }), [false])
  assert.equal(check(normal, 'media', { mediaType: 'audio' }), false)
  const afterBlock = prompts.length
  assert.deepEqual(await request(normal, 'media', { mediaTypes: ['audio'] }), [false])
  assert.equal(prompts.length, afterBlock)
  assert.equal(
    check(fixture(loadModule('../src/main/website-permissions.ts', electron)), 'media', {
      mediaType: 'audio'
    }),
    false
  )

  const temporary = fixture(api)
  temporary.contents.url = 'https://temporary.test'
  answer = { response: 1, checkboxChecked: false }
  assert.deepEqual(
    await request(temporary, 'notifications', { requestingUrl: temporary.contents.url }),
    [true]
  )
  assert.equal(check(temporary, 'notifications', { requestingUrl: temporary.contents.url }), false)
  answer = { response: 2, checkboxChecked: true }
  assert.deepEqual(
    await request(temporary, 'notifications', { requestingUrl: temporary.contents.url }),
    [false]
  )
  temporary.contents.isFocused = () => false
  const beforeBackground = prompts.length
  assert.deepEqual(
    await request(temporary, 'notifications', { requestingUrl: temporary.contents.url }),
    [false]
  )
  assert.equal(prompts.length, beforeBackground)
  temporary.contents.isFocused = () => true

  answer = 'pending'
  const responses = []
  temporary.session.request(
    temporary.contents,
    'notifications',
    (value) => responses.push(value),
    details({ requestingUrl: temporary.contents.url })
  )
  assert.deepEqual(
    await request(temporary, 'geolocation', { requestingUrl: temporary.contents.url }),
    [false]
  )
  const signal = prompts.at(-1).signal
  temporary.contents.emit('did-start-navigation')
  assert.deepEqual(responses, [false])
  assert.equal(signal.aborted, true)
  pendingAnswer({ response: 1, checkboxChecked: true })
  await settle()
  assert.deepEqual(responses, [false])
  assert.equal(check(temporary, 'notifications', { requestingUrl: temporary.contents.url }), false)

  for (const event of ['destroyed', 'render-process-gone']) {
    const target = fixture(api, true)
    const results = []
    target.session.request(
      target.contents,
      'notifications',
      (value) => results.push(value),
      details()
    )
    target.contents.emit(event)
    pendingAnswer({ response: 1, checkboxChecked: true })
    await settle()
    assert.deepEqual(results, [false])
    assert.equal(check(target, 'notifications'), false)
  }
  const clearing = fixture(api, true)
  const clearingResults = []
  clearing.session.request(
    clearing.contents,
    'notifications',
    (value) => clearingResults.push(value),
    details()
  )
  api.clearPrivateWebsitePermissions(clearing.session)
  pendingAnswer({ response: 1, checkboxChecked: true })
  await settle()
  assert.deepEqual(clearingResults, [false])
  assert.equal(check(clearing, 'notifications'), false)

  const closing = fixture(api, true)
  const closingResults = []
  closing.session.request(
    closing.contents,
    'notifications',
    (value) => closingResults.push(value),
    details()
  )
  closing.window.emit('closed')
  pendingAnswer({ response: 1, checkboxChecked: true })
  await settle()
  assert.deepEqual(closingResults, [false])
  assert.equal(check(closing, 'notifications'), false)

  const originalError = console.error
  const errors = []
  console.error = (...values) => errors.push(values)
  try {
    answer = new Error('Native prompt failed')
    assert.deepEqual(
      await request(temporary, 'notifications', { requestingUrl: temporary.contents.url }),
      [false]
    )
    answer = { response: 1, checkboxChecked: true }
    fs.mkdirSync(`${savedPath}.tmp`)
    try {
      assert.deepEqual(
        await request(temporary, 'notifications', { requestingUrl: temporary.contents.url }),
        [false]
      )
      assert.equal(
        check(temporary, 'notifications', { requestingUrl: temporary.contents.url }),
        false
      )
      assert.equal(
        check(fixture(loadModule('../src/main/website-permissions.ts', electron)), 'media', {
          mediaType: 'audio'
        }),
        false
      )
    } finally {
      fs.rmdirSync(`${savedPath}.tmp`)
    }
    assert.equal(errors.length, 2)
    assert.deepEqual(
      await request(temporary, 'notifications', { requestingUrl: temporary.contents.url }),
      [true]
    )
    assert.equal(check(temporary, 'notifications', { requestingUrl: temporary.contents.url }), true)
  } finally {
    console.error = originalError
  }

  active = privateTab.contents
  const privateScope = { contentsId: privateTab.contents.id }
  assert.deepEqual(get({ trusted: true }, privateScope), [])
  const beforePrivateEdit = fs.readFileSync(savedPath, 'utf8')
  assert.deepEqual(await request(privateTab, 'notifications'), [true])
  const privateDecisions = get({ trusted: true }, privateScope)
  assert.equal(privateDecisions.length, 1)
  assert.deepEqual(reset({ trusted: true }, privateDecisions[0], privateScope), [])
  assert.equal(check(privateTab, 'notifications'), false)
  assert.equal(check(normal, 'notifications'), true)
  assert.equal(fs.readFileSync(savedPath, 'utf8'), beforePrivateEdit)
  active = normal.contents
  assert.throws(() => reset({ trusted: true }, privateDecisions[0], privateScope), /changed/)
  assert.equal(check(normal, 'notifications'), true)
  active = temporary.contents
  const temporaryScope = { contentsId: temporary.contents.id }
  assert.equal(get({ trusted: true }, temporaryScope).length, 1)
  assert.throws(() => reset({ trusted: true }, saved[0], temporaryScope), /changed/)
  active = undefined
  assert.throws(() => get({ trusted: true }, temporaryScope), /no longer open/)
  console.log(
    'Website permissions: origins, media, clipboard, persistence, private isolation, IPC, and cancellation passed.'
  )
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
