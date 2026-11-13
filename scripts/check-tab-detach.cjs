const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-detach-check-'))
  const env = { ...process.env, REI_DETACH_CHECK_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 60000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-detach-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, screen, webContents } = require('electron')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  `${bundle}\nmodule.exports = { attachBrowser, SearchStore, ExtensionRuntime }`,
  bundlePath
)
app.setPath('userData', process.env.REI_DETACH_CHECK_PROFILE)
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitFor(check, message) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(20)
  }
  assert.fail(message)
}

app.whenReady().then(async () => {
  const store = new browserModule.exports.SearchStore(':memory:')
  const extensions = new browserModule.exports.ExtensionRuntime()
  const server = createServer((_request, response) => {
    response.end(
      '<!doctype html><title>Transfer fixture</title><input id="draft"><script>window.identity = crypto.randomUUID()</script>'
    )
  })
  const windows = []
  let cursor = { x: -100, y: -100 }
  let failCreation = false
  screen.getCursorScreenPoint = () => cursor
  const create = (detached) => {
    if (failCreation) throw new Error('Expected window creation failure')
    const window = new BaseWindow({ x: 200, y: 200, width: 900, height: 670, show: false })
    const chrome = browserModule.exports.attachBrowser(window, store, extensions, create, detached)
    const client = { window, chrome, sidebar: window.contentView.children[0].webContents }
    for (const contents of [chrome, client.sidebar])
      contents.on('console-message', (details) => {
        if (details.level === 'error') console.error('Test renderer:', details.message)
      })
    windows.push(client)
    client.ready = (async () => {
      await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
      await waitFor(() => !client.sidebar.isLoading() && client.sidebar.getURL(), 'sidebar loads')
      await chrome.executeJavaScript('void window.api.onState(state => window.testState = state)')
      await waitFor(async () => (await state(client))?.tabs.length > 0, 'window state arrives')
    })()
    return client
  }
  const state = (client) => client.chrome.executeJavaScript('window.testState')
  const detach = (client, id) =>
    client.sidebar.executeJavaScript(`window.api.detachTab(${JSON.stringify(id)})`)
  const startDrag = (client, id) =>
    client.sidebar.executeJavaScript(`(() => {
    const row = [...document.querySelectorAll('.vertical-tab')]
      .find(element => element.dataset.tabId === ${JSON.stringify(id)});
    const dataTransfer = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    return dataTransfer.getData('application/x-rei-tab');
  })()`)
  const drop = (client, token, targetId = '') =>
    client.sidebar.executeJavaScript(`(async () => {
    const area = document.querySelector('[aria-label="Browser tabs"]');
    const row = [...document.querySelectorAll('.vertical-tab')]
      .find(element => element.dataset.tabId === ${JSON.stringify(targetId)});
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('application/x-rei-tab', ${JSON.stringify(token)});
    const clientY = row ? row.getBoundingClientRect().top + 1
      : document.querySelector('.tab-list').getBoundingClientRect().bottom + 20;
    const over = new DragEvent('dragover', {
      bubbles: true, cancelable: true, dataTransfer, clientY
    });
    area.dispatchEvent(over);
    await Promise.resolve();
    const indicatorVisible = document.querySelector('.tab-drop-indicator').classList.contains('visible');
    const released = new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer, clientY
    });
    area.dispatchEvent(released);
    return { accepted: over.defaultPrevented && released.defaultPrevented, indicatorVisible };
  })()`)
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/`
    const source = create()
    await source.ready
    await source.chrome.executeJavaScript(`window.api.navigate(${JSON.stringify(url)})`)
    await waitFor(
      async () => (await state(source)).tabs[0].title === 'Transfer fixture',
      'fixture loads'
    )
    const original = await state(source)
    const id = original.activeTabId
    const page = webContents.fromId(original.activeWebContentsId)
    await page.executeJavaScript(
      'document.querySelector("input").value = "unsaved draft"; history.pushState({}, "", "/edited")'
    )
    const identity = await page.executeJavaScript('window.identity')
    const history = page.navigationHistory.getAllEntries()
    const inputListeners = page.listenerCount('before-input-event')
    const navigationListeners = page.listenerCount('did-start-navigation')
    await source.chrome.executeJavaScript('window.api.newTab()')
    await waitFor(async () => (await state(source)).tabs.length === 2, 'second source tab opens')
    const preview = await source.sidebar.executeJavaScript(`(() => {
      const row = document.querySelector('.vertical-tab');
      const bounds = row.getBoundingClientRect();
      const dataTransfer = new DataTransfer();
      let result;
      dataTransfer.setDragImage = (image) => {
        const rect = image.getBoundingClientRect();
        result = {
          width: rect.width, left: rect.left, top: rect.top,
          expectedWidth: bounds.width,
          title: image.querySelector('.tab-title').textContent,
          background: getComputedStyle(image).backgroundColor,
          isTab: image.classList.contains('vertical-tab')
        };
      };
      row.dispatchEvent(new DragEvent('dragstart', {
        bubbles: true, dataTransfer, clientX: bounds.left + 10, clientY: bounds.top + 10
      }));
      result.types = [...dataTransfer.types];
      row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
      return result;
    })()`)
    assert.equal(preview.isTab, true)
    assert.equal(preview.width, preview.expectedWidth)
    assert.ok(preview.width > 0 && preview.left >= 0 && preview.top >= 0)
    assert.ok(preview.title.includes('Transfer fixture'))
    assert.notEqual(preview.background, 'rgba(0, 0, 0, 0)')
    assert.deepEqual(preview.types, ['application/x-rei-tab'])

    cursor = { x: 300, y: 300 }
    await detach(source, id)
    await delay(50)
    assert.equal(windows.length, 1, 'inside-window release does not tear off')
    cursor = { x: -100, y: -100 }
    await source.chrome.executeJavaScript(`window.api.detachTab(${JSON.stringify(id)})`)
    await delay(50)
    assert.equal(windows.length, 1, 'only sidebar can request tear-off')
    await detach(source, 'missing')
    await delay(50)
    assert.equal(windows.length, 1, 'unknown tab cannot tear off')

    const beforeFailure = await state(source)
    failCreation = true
    await detach(source, id)
    await delay(100)
    const afterFailure = await state(source)
    assert.deepEqual(
      afterFailure.tabs.map((tab) => tab.id),
      beforeFailure.tabs.map((tab) => tab.id)
    )
    assert.equal(afterFailure.activeTabId, beforeFailure.activeTabId)
    assert.equal(page.listenerCount('did-start-navigation'), navigationListeners)
    failCreation = false
    await detach(source, id)
    await waitFor(() => windows.length === 2, 'tear-off creates window')
    const target = windows[1]
    await target.ready
    assert.equal((await state(source)).tabs.length, 1)
    assert.equal((await state(target)).activeWebContentsId, page.id)
    assert.equal(await page.executeJavaScript('window.identity'), identity)
    assert.equal(
      await page.executeJavaScript('document.querySelector("input").value'),
      'unsaved draft'
    )
    assert.deepEqual(page.navigationHistory.getAllEntries(), history)
    assert.equal(page.listenerCount('before-input-event'), inputListeners)
    assert.equal(page.listenerCount('did-start-navigation'), navigationListeners)
    assert.equal(extensions.api.ctx.store.tabToWindow.get(page), target.window)
    await page.executeJavaScript('document.title = "Moved page"')
    await waitFor(
      async () => (await state(target)).tabs[0].title === 'Moved page',
      'events reach new owner'
    )
    assert.notEqual((await state(source)).tabs[0].title, 'Moved page')

    failCreation = true
    await detach(target, id)
    await delay(100)
    assert.equal(
      (await state(target)).activeWebContentsId,
      page.id,
      'failed transfer restores source'
    )
    assert.equal(page.listenerCount('before-input-event'), inputListeners)
    assert.equal(page.listenerCount('did-start-navigation'), navigationListeners)
    failCreation = false
    await detach(target, id)
    await waitFor(() => windows.length === 3, 'single-tab tear-off creates window')
    const last = windows[2]
    await last.ready
    assert.equal(target.window.isDestroyed(), true, 'empty source window closes')
    assert.equal(page.isDestroyed(), false, 'closing source preserves transferred page')
    assert.equal((await state(last)).activeWebContentsId, page.id)
    assert.equal(page.listenerCount('before-input-event'), inputListeners)
    assert.equal(page.listenerCount('did-start-navigation'), navigationListeners)
    assert.equal(extensions.api.ctx.store.tabToWindow.get(page), last.window)

    await source.chrome.executeJavaScript('window.api.newIncognitoTab()')
    await waitFor(
      async () => (await state(source)).tabs.some((tab) => tab.incognito),
      'private tab opens'
    )
    const privateState = await state(source)
    const privatePage = webContents.fromId(privateState.activeWebContentsId)
    await privatePage.session.cookies.set({ url, name: 'private-transfer', value: 'kept' })
    await detach(source, privateState.activeTabId)
    await waitFor(() => windows.length === 4, 'private tab detaches')
    const privateTarget = windows[3]
    await privateTarget.ready
    assert.equal((await state(privateTarget)).tabs[0].incognito, true)
    assert.equal((await state(privateTarget)).activeWebContentsId, privatePage.id)
    assert.equal(
      (await privatePage.session.cookies.get({ url, name: 'private-transfer' }))[0]?.value,
      'kept'
    )
    source.window.close()
    await delay(100)
    assert.equal(
      (await privatePage.session.cookies.get({ url, name: 'private-transfer' }))[0]?.value,
      'kept'
    )
    assert.equal(privatePage.isDestroyed(), false)

    const destination = create()
    await destination.ready
    await destination.chrome.executeJavaScript('window.api.newTab()')
    await waitFor(async () => (await state(destination)).tabs.length === 2, 'destination tabs open')
    const destinationIds = (await state(destination)).tabs.map((tab) => tab.id)
    assert.equal(
      await destination.chrome.executeJavaScript(
        `window.api.startTabDrag(${JSON.stringify(destinationIds[0])})`
      ),
      ''
    )
    assert.equal(
      await destination.sidebar.executeJavaScript('window.api.startTabDrag("missing")'),
      ''
    )
    await destination.sidebar.executeJavaScript('window.api.dropTab("forged-token", "")')
    await delay(50)
    assert.equal((await state(destination)).tabs.length, 2, 'forged drag cannot move tabs')
    const transferHistory = page.navigationHistory.getAllEntries()
    const token = await startDrag(last, id)
    assert.ok(token && token !== id)
    assert.deepEqual(await drop(destination, token, destinationIds[1]), {
      accepted: true,
      indicatorVisible: true
    })
    await waitFor(
      async () => (await state(destination)).tabs.length === 3,
      'cross-window drop transfers tab'
    )
    assert.deepEqual(
      (await state(destination)).tabs.map((tab) => tab.id),
      [destinationIds[0], id, destinationIds[1]]
    )
    assert.equal((await state(destination)).activeTabId, id)
    assert.equal(last.window.isDestroyed(), true)
    assert.equal(windows.length, 5, 'cross-window drop does not create another window')
    assert.equal(await page.executeJavaScript('window.identity'), identity)
    assert.equal(
      await page.executeJavaScript('document.querySelector("input").value'),
      'unsaved draft'
    )
    assert.deepEqual(page.navigationHistory.getAllEntries(), transferHistory)
    assert.equal(page.listenerCount('before-input-event'), inputListeners)
    assert.equal(page.listenerCount('did-start-navigation'), navigationListeners)
    assert.equal(extensions.api.ctx.store.tabToWindow.get(page), destination.window)
    await privateTarget.sidebar.executeJavaScript(
      `window.api.dropTab(${JSON.stringify(token)}, "")`
    )
    await delay(50)
    assert.equal((await state(privateTarget)).tabs.length, 1, 'consumed token cannot be replayed')
    const reorderToken = await startDrag(destination, id)
    await drop(destination, reorderToken)
    await waitFor(
      async () => (await state(destination)).tabs.at(-1).id === id,
      'same-window bottom drop reorders'
    )
    const returnToken = await startDrag(destination, id)
    await drop(privateTarget, returnToken)
    await waitFor(
      async () => (await state(privateTarget)).tabs.length === 2,
      'cross-window bottom drop appends'
    )
    assert.equal((await state(privateTarget)).tabs.at(-1).id, id)
    assert.equal((await state(destination)).tabs.length, 2)
    assert.equal(extensions.api.ctx.store.tabToWindow.get(page), privateTarget.window)

    const otherPrivate = create()
    await otherPrivate.ready
    await otherPrivate.chrome.executeJavaScript('window.api.newIncognitoTab()')
    await waitFor(
      async () => (await state(otherPrivate)).tabs.some((tab) => tab.incognito),
      'second private session opens'
    )
    const otherPrivateState = await state(otherPrivate)
    const otherPrivatePage = webContents.fromId(otherPrivateState.activeWebContentsId)
    const otherPrivateSession = otherPrivatePage.session
    const originalPrivateSession = privatePage.session
    assert.notEqual(otherPrivateSession, originalPrivateSession)
    await otherPrivateSession.cookies.set({ url, name: 'private-transfer', value: 'separate' })
    const privateToken = await startDrag(otherPrivate, otherPrivateState.activeTabId)
    await drop(privateTarget, privateToken, privateState.activeTabId)
    await waitFor(
      async () => (await state(privateTarget)).tabs.length === 3,
      'private sessions coexist after drop'
    )
    assert.deepEqual(
      (await state(privateTarget)).tabs.map((tab) => tab.id),
      [otherPrivateState.activeTabId, privateState.activeTabId, id]
    )
    otherPrivate.window.close()
    await delay(50)
    assert.equal(
      (await originalPrivateSession.cookies.get({ url, name: 'private-transfer' }))[0]?.value,
      'kept'
    )
    assert.equal(
      (await otherPrivateSession.cookies.get({ url, name: 'private-transfer' }))[0]?.value,
      'separate'
    )
    await privateTarget.chrome.executeJavaScript(
      `window.api.closeTab(${JSON.stringify(privateState.activeTabId)})`
    )
    await waitFor(
      async () =>
        !(await originalPrivateSession.cookies.get({ url, name: 'private-transfer' })).length,
      'closed private session clears'
    )
    assert.equal(
      (await otherPrivateSession.cookies.get({ url, name: 'private-transfer' }))[0]?.value,
      'separate'
    )
    await privateTarget.chrome.executeJavaScript(
      `window.api.closeTab(${JSON.stringify(otherPrivateState.activeTabId)})`
    )
    await waitFor(
      async () =>
        !(await otherPrivateSession.cookies.get({ url, name: 'private-transfer' })).length,
      'second private session clears independently'
    )
    assert.equal(page.isDestroyed(), false)
    console.log(
      'PASS: tear-off, cross-window insertion and append, same-window reorder, authenticated drags, live page preservation, rollback, last-tab closure, and independent private sessions'
    )
    for (const client of windows) if (!client.window.isDestroyed()) client.window.destroy()
    store.close()
    server.close()
    app.exit(0)
  } catch (error) {
    console.error('FAIL:', error.stack)
    for (const client of windows) if (!client.window.isDestroyed()) client.window.destroy()
    store.close()
    server.close()
    app.exit(1)
  }
})
