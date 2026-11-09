const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/main/default-browser.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function setup({
  lock = true,
  platform = 'win32',
  packaged = true,
  argv = ['rei'],
  defaultApp = false
} = {}) {
  const protocols = []
  const external = []
  const app = Object.assign(new EventEmitter(), {
    isPackaged: packaged,
    requestSingleInstanceLock: () => lock,
    setAsDefaultProtocolClient: (protocol) => {
      protocols.push(protocol)
      return true
    }
  })
  const context = vm.createContext({
    exports: {},
    URL,
    process: { platform, argv, defaultApp },
    require: (name) => {
      assert.equal(name, 'electron')
      return { app, shell: { openExternal: async (url) => external.push(url) } }
    }
  })
  vm.runInContext(compiled, context)
  const api = context.exports
  const windows = []
  function createWindow() {
    const window = Object.assign(new EventEmitter(), {
      urls: [],
      minimized: false,
      shows: 0,
      focuses: 0,
      isMinimized() {
        return this.minimized
      },
      restore() {
        this.minimized = false
      },
      show() {
        this.shows += 1
      },
      focus() {
        this.focuses += 1
        this.emit('focus')
      }
    })
    windows.push(window)
    api.registerLinkWindow(window, (url) => window.urls.push(url))
    return window
  }
  return { api, app, protocols, external, windows, createWindow }
}

async function run() {
  let prevented = 0
  const event = {
    preventDefault() {
      prevented += 1
    }
  }
  const cold = setup({
    argv: ['rei', '--flag', 'https://example.com/first?a=1&b=2', 'http://example.com/second']
  })
  assert.equal(cold.api.startLinkRouting(), true)
  cold.app.emit('open-url', event, 'https://example.com/mac')
  cold.app.emit('second-instance', {}, ['rei', 'https://example.com/queued'])
  assert.equal(cold.windows.length, 0)
  cold.api.finishLinkRouting(cold.createWindow)
  assert.equal(cold.windows.length, 1)
  assert.deepEqual(cold.windows[0].urls, [
    'https://example.com/first?a=1&b=2',
    'http://example.com/second',
    'https://example.com/mac',
    'https://example.com/queued'
  ])
  const first = cold.windows[0]
  const second = cold.createWindow()
  const third = cold.createWindow()
  first.focus()
  second.focus()
  second.minimized = true
  cold.app.emit('second-instance', {}, ['rei', 'https://example.com/warm'])
  assert.equal(cold.windows.length, 3)
  assert.deepEqual(second.urls, ['https://example.com/warm'])
  assert.equal(second.minimized, false)
  second.emit('closed')
  cold.app.emit('second-instance', {}, ['rei', 'https://example.com/fallback'])
  assert.equal(first.urls.at(-1), 'https://example.com/fallback')
  const focuses = first.focuses
  cold.app.emit('second-instance', {}, ['rei'])
  assert.equal(first.focuses, focuses + 1)
  first.emit('closed')
  third.emit('closed')
  cold.app.emit('open-url', event, 'https://example.com/reopen')
  assert.equal(cold.windows.length, 4)
  assert.deepEqual(cold.windows[3].urls, ['https://example.com/reopen'])

  const rejected = [
    '--url=https://example.com',
    'javascript:alert(1)',
    'file:///secret',
    'rei://settings',
    'https://',
    'https://user:secret@example.com',
    'https://example.com/\n',
    `https://example.com/${'x'.repeat(8192)}`
  ]
  assert.deepEqual(Array.from(cold.api.externalURLs(rejected)), [])
  assert.deepEqual(Array.from(cold.api.externalURLs(['HTTPS://example.com/%20?q=%22'])), [
    'HTTPS://example.com/%20?q=%22'
  ])
  const before = cold.windows[3].focuses
  cold.app.emit('open-url', event, 'javascript:alert(1)')
  assert.equal(prevented, 3)
  assert.equal(cold.windows[3].focuses, before)

  const secondary = setup({ lock: false })
  assert.equal(secondary.api.startLinkRouting(), false)
  assert.equal(secondary.app.listenerCount('second-instance'), 0)
  const dev = setup({
    defaultApp: true,
    argv: ['electron', 'https://not-an-argument.example', 'https://example.com/dev']
  })
  dev.api.startLinkRouting()
  dev.api.finishLinkRouting(dev.createWindow)
  assert.deepEqual(dev.windows[0].urls, ['https://example.com/dev'])
  const empty = setup()
  empty.api.startLinkRouting()
  empty.api.finishLinkRouting(empty.createWindow)
  assert.equal(empty.windows.length, 1)

  for (const platform of ['win32', 'darwin', 'linux']) {
    const runtime = setup({ platform })
    const handlers = new Map()
    runtime.api.registerDefaultBrowser(
      { ipc: { handle: (name, handler) => handlers.set(name, handler) } },
      (event) => event.trusted
    )
    const makeDefault = handlers.get('browser:make-default')
    await assert.rejects(() => makeDefault({ trusted: false }), /access denied/)
    assert.equal(runtime.external.length, 0)
    assert.equal(runtime.protocols.length, 0)
    await makeDefault({ trusted: true })
    if (platform === 'win32') {
      assert.deepEqual(runtime.external, ['ms-settings:defaultapps?registeredAppUser=Rei'])
      assert.deepEqual(runtime.protocols, [])
      runtime.external.length = 0
      runtime.app.isPackaged = false
      await assert.rejects(() => makeDefault({ trusted: true }), /Install Rei/)
      assert.equal(runtime.external.length, 0)
    } else {
      assert.deepEqual(runtime.protocols, ['http', 'https'])
      runtime.app.setAsDefaultProtocolClient = () => false
      await assert.rejects(() => makeDefault({ trusted: true }), /system settings/)
    }
  }

  const yaml = require('js-yaml')
  const config = yaml.load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'))
  await require('app-builder-lib/out/util/config/config').validateConfiguration(config, {
    isEnabled: false
  })
  assert.equal(config.nsis.include, 'build/default-browser.nsh')
  assert.deepEqual(config.mac.protocols[0].schemes, ['http', 'https'])
  assert.deepEqual(config.linux.protocols[0].schemes, ['http', 'https'])
  assert.equal(config.protocols, undefined)
  const installer = fs.readFileSync(path.join(root, config.nsis.include), 'utf8')
  assert.match(installer, /Capabilities\\URLAssociations" "http" "ReiHTML"/)
  assert.match(installer, /Capabilities\\URLAssociations" "https" "ReiHTML"/)
  assert.match(installer, /'"\$appExe" "%1"'/)
  assert.doesNotMatch(installer, /UserChoice|Software\\Classes\\https?"/)
  const { LinuxTargetHelper } = require('app-builder-lib/out/targets/LinuxTargetHelper')
  const desktop = await LinuxTargetHelper.prototype.computeDesktopEntry.call(
    {
      getDescription: () => 'Rei browser',
      packager: {
        config,
        platformSpecificBuildOptions: config.linux,
        executableName: 'rei',
        fileAssociations: [],
        appInfo: { sanitizedProductName: 'rei', productName: 'rei', description: 'Rei browser' },
        info: { metadata: { desktopName: 'rei.desktop' } }
      }
    },
    config.linux
  )
  assert.match(desktop, /Exec=.* %U\n/)
  assert.match(desktop, /MimeType=x-scheme-handler\/http;x-scheme-handler\/https;/)
  assert.match(desktop, /Categories=Network;WebBrowser;/)
  console.log(
    'Default browser: cold/warm links, startup queue, single-instance, window focus, validation, IPC, and packaging passed.'
  )
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
