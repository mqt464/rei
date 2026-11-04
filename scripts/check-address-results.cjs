const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-address-results-'))
  const env = { ...process.env, REI_ADDRESS_RESULTS_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 30000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-address-results-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { app, BaseWindow } = require('electron')
app.setPath('userData', process.env.REI_ADDRESS_RESULTS_PROFILE)
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0] +
    '\nmodule.exports = { attachBrowser, SearchStore }',
  bundlePath
)

async function waitFor(check, message) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

app.whenReady().then(async () => {
  const store = new browserModule.exports.SearchStore(':memory:')
  const window = new BaseWindow({ width: 1000, height: 760, show: false })
  try {
    const chrome = browserModule.exports.attachBrowser(window, store)
    chrome.ipc.removeHandler('browser:suggest')
    chrome.ipc.handle('browser:suggest', async (event, query, mode, requestId, online) => {
      if (!query) return { results: [] }
      if (mode === 'search') {
        const response = { results: [{ id: 'search:local', kind: 'search', title: query, query }] }
        event.sender.send('browser:search-update', { requestId, response, pending: !!online })
        if (!online) return response
      }
      await new Promise((resolve) => setTimeout(resolve, query === 'result' ? 10 : 150))
      const response = {
        results: Array.from({ length: 24 }, (_, index) => ({
          id: `fixture:${index}`,
          kind: 'website',
          title: `${query} ${index}`,
          url: `https://example.com/${index}`
        }))
      }
      event.sender.send('browser:search-update', { requestId, response, pending: false })
      return response
    })
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const read = async (script) => {
      try {
        return await chrome.executeJavaScript(script)
      } catch (error) {
        throw new Error(`${error.message}\nScript: ${script}`, { cause: error })
      }
    }
    await read('window.api.newTab()')
    await waitFor(
      () => read('document.activeElement?.getAttribute("role") === "combobox"'),
      'new tab must focus address'
    )
    const type = (value) =>
      read(`(() => {
      const input = document.querySelector('[role="combobox"]');
      input.focus(); input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await type('result')
    await waitFor(
      () => read('document.querySelectorAll(".suggestion-option").length === 24'),
      'fixture results must load'
    )
    await read('window.originalOption = document.getElementById("address-option-1")')
    await type('results')
    assert.equal(
      await read('window.originalOption.isConnected'),
      true,
      'typing must retain results while IPC is pending'
    )
    await waitFor(
      () => read('document.getElementById("address-option-1")?.textContent.includes("results 1")'),
      'updated results must arrive'
    )
    assert.equal(
      await read('window.originalOption === document.getElementById("address-option-1")'),
      true,
      'stable IDs must preserve DOM nodes'
    )
    assert.equal(
      await read('!!document.querySelector(".suggestion-scroll .fluid-hover [data-fluid-hover]")'),
      true,
      'results must use FluidHover inside ScrollArea'
    )
    await read(`(() => {
      const option = document.querySelector('[data-fluid-hover]');
      const bounds = option.getBoundingClientRect();
      option.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: bounds.left + 10, clientY: bounds.top + 10 }));
    })()`)
    assert.equal(
      await read('!!document.querySelector(".suggestion-scroll .fluid-hover-indicator.active")'),
      true,
      'pointer movement must activate shared hover'
    )
    const key = (name) =>
      read(
        `document.querySelector('[role="combobox"]').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true }))`
      )
    const scrollTop = () =>
      read('document.querySelector(".suggestion-scroll .scroll-area").scrollTop')
    await key('ArrowDown')
    assert.equal(await scrollTop(), 0, 'visible selections must not scroll')
    for (let index = 0; index < 15; index++) await key('ArrowDown')
    const position = await read(`(() => {
      const area = document.querySelector('.suggestion-scroll .scroll-area');
      const selected = document.querySelector('[aria-selected="true"]').getBoundingClientRect();
      const bounds = area.getBoundingClientRect();
      return { scrollTop: area.scrollTop, visible: selected.top >= bounds.top - 1 && selected.bottom <= bounds.bottom + 1 };
    })()`)
    assert.ok(
      position.scrollTop > 0 && position.visible,
      'offscreen selection must scroll into view'
    )
    await key('ArrowUp')
    assert.equal(await scrollTop(), position.scrollTop, 'moving within viewport must not scroll')
    for (let index = 0; index < 15; index++) await key('ArrowUp')
    assert.equal(await scrollTop(), 0, 'returning to first result must reveal it')
    await key('ArrowUp')
    assert.equal(
      await read(`document.querySelector('[aria-selected="true"]').id`),
      'address-option-23',
      'selection must wrap to last result'
    )
    assert.ok((await scrollTop()) > 0, 'wrapping to last result must reveal it')
    await key('ArrowDown')
    assert.equal(await scrollTop(), 0, 'wrapping to first result must reveal it')
    await read(
      `document.querySelector('[role="combobox"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }))`
    )
    await waitFor(
      () => read('document.querySelectorAll(".suggestion-option").length === 24'),
      'online results must load'
    )
    await read(`
      window.originalOption = document.getElementById('address-option-1');
      window.resultRemoved = false;
      window.resultObserver = new MutationObserver(() => {
        if (!window.originalOption.isConnected) window.resultRemoved = true;
      });
      window.resultObserver.observe(document.getElementById('address-suggestions'), { childList: true, subtree: true });
    `)
    await type('results online')
    assert.ok(
      await read(
        'document.querySelector(".suggestion-option").textContent.includes("results online")'
      ),
      'default action must use current query while online results are pending'
    )
    await waitFor(
      () =>
        read(
          'document.getElementById("address-option-1")?.textContent.includes("results online 1")'
        ),
      'final online results must arrive'
    )
    assert.equal(
      await read('window.resultRemoved'),
      false,
      'debounce and provisional online updates must not clear existing rows'
    )
    await read('window.resultObserver.disconnect()')
    await type('')
    assert.equal(
      await read('!!document.querySelector(".suggestion-panel")'),
      false,
      'clearing query must close results'
    )
    console.log(
      'PASS: stable results, shared hover/scroll, nearest-edge keyboard scrolling and wrapping'
    )
    window.close()
    store.close()
    app.exit(0)
  } catch (error) {
    console.error('FAIL:', error.stack)
    if (!window.isDestroyed()) window.close()
    store.close()
    app.exit(1)
  }
})
