const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-history-check-'))
  const env = { ...process.env, REI_HISTORY_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 60000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-history-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { DatabaseSync } = require('node:sqlite')
const { createServer } = require('node:http')
const { app, BaseWindow, dialog, clipboard, webContents } = require('electron')
app.setPath('userData', process.env.REI_HISTORY_PROFILE)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0] +
    '\nmodule.exports = { attachBrowser, SearchStore, parseHistoryQuery, parseHistoryRemoval }',
  bundlePath
)
const { attachBrowser, SearchStore, parseHistoryQuery, parseHistoryRemoval } = browserModule.exports
const filter = { query: '', start: 0, end: Number.MAX_SAFE_INTEGER, host: '', offset: 0 }

async function waitFor(check, message) {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(message)
}

function checkStorage() {
  assert.throws(() => parseHistoryQuery({ ...filter, query: 'x'.repeat(513) }))
  assert.throws(() => parseHistoryQuery({ ...filter, start: NaN }))
  assert.throws(() => parseHistoryQuery({ ...filter, end: 0 }))
  assert.throws(() => parseHistoryQuery({ ...filter, offset: -1 }))
  for (const invalid of [
    {},
    { ids: [] },
    { ids: [-1] },
    { ids: [1.5] },
    { ids: [1], start: 0 },
    { start: 1, end: 1 }
  ])
    assert.throws(() => parseHistoryRemoval(invalid))
  const store = new SearchStore(':memory:')
  const clock = Date.now
  const now = clock()
  try {
    Date.now = () => now - 2 * 86400000
    store.visit('https://example.test/a', 'Older visit', undefined, true)
    Date.now = () => now
    store.visit('https://example.test/a', 'Latest title \u00c9COLE', undefined, false)
    store.visit('https://other.test/b', 'Other title', undefined, false)
    store.visit('javascript:alert(1)', 'Unsafe', undefined, false)
    store.visit('https://user:password@example.test/', 'Credentials', undefined, false)
    store.select('learned', 'https://example.test/a')
    assert.equal(store.historyPage(filter).total, 3)
    assert.equal(store.historyPage({ ...filter, query: 'LATEST' }).total, 2)
    assert.equal(store.historyPage({ ...filter, query: '\u00e9cole' }).total, 2)
    assert.equal(store.historyPage({ ...filter, query: "%' OR 1=1" }).total, 0)
    assert.equal(store.historyPage({ ...filter, host: 'example.test' }).total, 2)
    assert.equal(store.historyPage({ ...filter, host: '%' }).total, 0)
    assert.equal(store.historyPage({ ...filter, start: now - 1000 }).total, 2)
    const latest = store.historyPage({ ...filter, host: 'example.test' }).visits[0]
    const generation = store.generation
    store.removeHistory({ ids: [latest.id] })
    assert.equal(store.historyVisit(latest.id), undefined)
    assert.equal(
      store.history('learned').find((entry) => entry.url.endsWith('/a')).lastVisit,
      now - 2 * 86400000
    )
    assert.equal(store.history('learned').find((entry) => entry.url.endsWith('/a')).visits, 1)
    assert.equal(store.history('learned').find((entry) => entry.url.endsWith('/a')).typedVisits, 1)
    assert.ok(store.generation > generation)
    store.removeHistory({ start: 0, end: now - 1000 })
    assert.equal(store.historyPage(filter).total, 1)
    assert.equal(
      store.history('learned').some((entry) => entry.url.endsWith('/a')),
      false
    )
    for (let index = 0; index < 62; index++)
      store.visit(`https://pages.test/${index}`, `Page ${index}`, undefined, false)
    const first = store.historyPage(filter)
    const second = store.historyPage({ ...filter, offset: 50 })
    assert.equal(first.visits.length, 50)
    assert.equal(second.visits.length, 13)
    assert.equal(new Set([...first.visits, ...second.visits].map((visit) => visit.id)).size, 63)
    assert.equal(store.clear(), true)
    assert.equal(store.historyPage(filter).total, 0)
  } finally {
    Date.now = clock
    store.close()
  }
  const filename = path.join(app.getPath('userData'), 'migration.sqlite')
  const old = new DatabaseSync(filename)
  old.exec(`CREATE TABLE history(url TEXT PRIMARY KEY, title TEXT NOT NULL, favicon TEXT,
    visits INTEGER NOT NULL, typed_visits INTEGER NOT NULL, last_visit INTEGER NOT NULL);
    PRAGMA user_version = 1;`)
  old
    .prepare('INSERT INTO history VALUES (?, ?, NULL, 7, 3, ?)')
    .run('https://legacy.test/', 'Legacy', now)
  old.close()
  const migrated = new SearchStore(filename)
  assert.equal(migrated.historyPage(filter).total, 1)
  assert.equal(migrated.history('')[0].visits, 7)
  migrated.close()
  const reopened = new SearchStore(filename)
  assert.equal(reopened.historyPage(filter).total, 1, 'migration must not duplicate visits')
  reopened.close()
}

app.whenReady().then(async () => {
  let store
  let window
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>History fixture</title><p>History fixture</p>')
  })
  try {
    checkStorage()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/history`
    store = new SearchStore(':memory:')
    window = new BaseWindow({ width: 1000, height: 760, show: true })
    const chrome = attachBrowser(window, store)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const read = (script) => chrome.executeJavaScript(script, true)
    const historyMatches = async (total, query = '') => {
      const expected = store.historyPage({ ...filter, query })
      const actual = await read(`({
        ready: document.querySelector('[aria-label="Browsing history"] > [aria-busy]')?.getAttribute('aria-busy') === 'false',
        ids: Array.from(document.querySelectorAll('.visit-check')).map(input => Number(input.name.replace('history-visit-', '')))
      })`)
      return (
        expected.total === total &&
        actual.ready &&
        actual.ids.join(',') === expected.visits.map((visit) => visit.id).join(',')
      )
    }
    await read('void window.api.onState(state => window.historyState = state)')
    const state = () => read('window.historyState')
    await waitFor(async () => (await state())?.tabs.length === 1, 'initial tab')
    chrome.focus()
    chrome.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['control'] })
    chrome.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['control'] })
    await waitFor(() => read('!!document.querySelector("#history-search")'), 'Ctrl+H opens history')
    await waitFor(
      () => read('document.body.textContent.includes("No history yet.")'),
      'empty state'
    )
    assert.equal(
      await read(`(() => {
      const card = document.querySelector('.empty-history').closest('.rei-card');
      const search = document.querySelector('.history-tools');
      return card.getBoundingClientRect().top - search.getBoundingClientRect().bottom >= 16;
    })()`),
      true,
      'empty history card has spacing below search'
    )
    const historyId = (await state()).activeTabId
    assert.equal((await state()).url, 'rei://settings/history')
    await read('window.api.openHistory()')
    assert.equal((await state()).tabs.length, 2, 'history reuses settings tab')
    for (let index = 0; index < 63; index++)
      store.visit(`https://example.test/${index}`, `Saved page ${index}`, undefined, false)
    store.visit(url, 'Local history page', undefined, true)
    await waitFor(
      () => read('document.querySelectorAll(".history-visit").length === 50'),
      'live visits and pagination'
    )
    await waitFor(() => historyMatches(64), 'all visits load')
    assert.equal(
      await read(
        '!!document.querySelector(".result-count, [name=history-select-all], .selection-bar")'
      ),
      false,
      'no select-page or visit-count toolbar'
    )
    await read('document.querySelector(".history-pagination button:last-child").click()')
    await waitFor(
      () => read('document.querySelectorAll(".history-visit").length === 14'),
      'next page'
    )
    await read('document.querySelector(".history-pagination button:first-child").click()')
    await waitFor(
      () => read('document.querySelectorAll(".history-visit").length === 50'),
      'previous page'
    )
    await read(
      `(() => { const input = document.querySelector('#history-search'); input.value = 'Local history'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`
    )
    await waitFor(
      () => read('document.querySelectorAll(".history-visit").length === 1'),
      'search by title'
    )
    await read('document.querySelector("summary").click()')
    await read(
      'Array.from(document.querySelectorAll(".visit-actions button")).find(button => button.textContent === "Copy link").click()'
    )
    await waitFor(
      () =>
        read(
          'document.querySelector(".history-status")?.textContent === "Link copied." || !!document.querySelector(".history-error")'
        ),
      'copy completes'
    )
    assert.equal(
      await clipboard.readText(),
      url,
      `copy link: ${await read('document.querySelector(".history-error")?.textContent')}`
    )
    await read('document.querySelector("summary").click()')
    await read(
      'Array.from(document.querySelectorAll(".visit-actions button")).find(button => button.textContent === "More from this site").click()'
    )
    await waitFor(() => read('!!document.querySelector(".site-filter")'), 'site filter')
    await read('document.querySelector(".site-filter button").click()')
    await waitFor(() => read('!document.querySelector(".site-filter")'), 'clear site filter')
    const localVisit = store.historyPage({ ...filter, query: 'Local history' }).visits[0]
    await read(`window.api.openHistoryVisit(${localVisit.id}, 'background')`)
    await waitFor(async () => (await state()).tabs.length === 3, 'background history tab')
    assert.equal((await state()).activeTabId, historyId)
    await waitFor(
      () => store.historyPage({ ...filter, query: url }).total === 2,
      'normal browsing records another visit'
    )
    const normalCount = store.historyPage(filter).total
    await read(`window.api.openHistoryVisit(${localVisit.id}, 'incognito')`)
    await waitFor(
      async () => (await state()).tabs.some((tab) => tab.incognito),
      'private history tab'
    )
    await waitFor(() => {
      const privatePage = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === url && contents.session.isPersistent() === false)
      return privatePage && !privatePage.isLoading()
    }, 'private page loads')
    assert.equal(store.historyPage(filter).total, normalCount, 'incognito must not record visits')
    await read('window.api.openHistory()')
    await waitFor(async () => (await state()).activeTabId === historyId, 'return to history')
    await read(
      `(() => { const input = document.querySelector('#history-search'); input.value = 'Saved page'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`
    )
    await waitFor(() => historyMatches(63, 'Saved page'), 'search resets pagination')
    let confirm = 1
    let confirmations = 0
    dialog.showMessageBox = async () => {
      confirmations++
      return { response: confirm }
    }
    await read('document.querySelector(".history-visit .icon-button").click()')
    await waitFor(() => confirmations === 1, 'delete must confirm')
    assert.equal(
      store.historyPage({ ...filter, query: 'Saved page' }).total,
      63,
      'cancel keeps history'
    )
    confirm = 0
    await read('document.querySelector(".history-visit .icon-button").click()')
    await waitFor(() => historyMatches(62, 'Saved page'), 'single deletion updates history')
    assert.equal(
      await read('document.body.textContent.includes("History deleted.")'),
      false,
      'deletion has no action text'
    )
    await read(
      'document.querySelector(".visit-check").click(); document.querySelectorAll(".visit-check")[2].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }))'
    )
    assert.equal(
      await read('document.querySelectorAll(".visit-check:checked").length'),
      3,
      'Shift-click selects range'
    )
    await read(
      'Array.from(document.querySelectorAll(".selection-bar button")).find(button => button.textContent === "Delete selected").click()'
    )
    await waitFor(() => historyMatches(59, 'Saved page'), 'bulk deletion')
    await read('document.querySelector("#history-range").click()')
    await waitFor(() => read('!!document.querySelector("[data-value=custom]")'), 'date range menu')
    await read('document.querySelector("[data-value=custom]").click()')
    await waitFor(() => read('!!document.querySelector(".date-range")'), 'custom dates')
    await read(
      'document.querySelector("[name=history-from]").value = "2099-01-01"; document.querySelector("[name=history-from]").dispatchEvent(new Event("input", { bubbles: true }))'
    )
    await waitFor(
      () =>
        read(
          'document.querySelector(".history-error")?.textContent.includes("Choose a valid date range.")'
        ),
      'invalid dates show error'
    )
    await read('document.querySelector("#history-range").click()')
    await waitFor(() => read('!!document.querySelector("[data-value=all]")'), 'reset range menu')
    await read('document.querySelector("[data-value=all]").click()')
    await waitFor(() => historyMatches(59, 'Saved page'), 'recover from invalid dates')
    for (const width of [560, 1000]) {
      window.setSize(width, 760)
      await read(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      assert.equal(
        await read(
          'document.querySelector(".settings-page").scrollWidth <= document.querySelector(".settings-page").clientWidth'
        ),
        true,
        `layout fits ${width}px`
      )
      if (process.env.REI_HISTORY_CAPTURES) {
        fs.mkdirSync(process.env.REI_HISTORY_CAPTURES, { recursive: true })
        fs.writeFileSync(
          path.join(process.env.REI_HISTORY_CAPTURES, `history-${width}.png`),
          (await chrome.capturePage()).toPNG()
        )
      }
    }
    await read('window.api.setPreferences({ historyEnabled: false })')
    const beforeDisabled = store.historyPage(filter).total
    await read(`window.api.openHistoryVisit(${localVisit.id}, 'tab')`)
    await waitFor(() => {
      const pages = webContents.getAllWebContents().filter((contents) => contents.getURL() === url)
      return pages.length >= 3 && pages.every((contents) => !contents.isLoading())
    }, 'disabled-history page loads')
    assert.equal(
      store.historyPage(filter).total,
      beforeDisabled,
      'history setting prevents recording'
    )
    await read('window.api.openHistory()')
    await waitFor(
      () => read('!!document.querySelector(".clear-controls")'),
      'history controls return'
    )
    await read('document.querySelector(".clear-controls button:last-child").click()')
    await waitFor(() => store.historyPage(filter).total === 0, 'clear all history')
    assert.equal(store.history('').length, 0, 'address-bar history clears too')
    await read('window.api.navigate("rei://settings/keybinds")')
    await waitFor(() => read('!!document.querySelector("#keybind-history")'), 'keybind is editable')
    console.log(
      'PASS: history migration, repeated visits, search, dates, sites, pagination, selection, confirmed deletion, copy, tabs, incognito, history preference, Ctrl+H, settings reuse, compact layouts'
    )
  } catch (error) {
    console.error(error.stack)
    process.exitCode = 1
  } finally {
    window?.destroy()
    store?.close()
    server.close()
    app.exit(process.exitCode || 0)
  }
})
