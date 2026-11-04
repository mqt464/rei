const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-settings-check-'))
  const env = { ...process.env, REI_SETTINGS_CHECK_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 30000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-settings-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { app, BaseWindow, dialog, nativeTheme, shell } = require('electron')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  `${bundle}\nmodule.exports = { attachBrowser, SearchStore, defaultColors, lightColors }`,
  bundlePath
)
app.setPath('userData', process.env.REI_SETTINGS_CHECK_PROFILE)

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
  const window = new BaseWindow({ width: 1000, height: 760, show: true })
  try {
    const chrome = browserModule.exports.attachBrowser(window, store)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'), { hash: 'tabs' })
    assert.equal(fs.existsSync(path.join(app.getPath('userData'), 'site-search.json')), false)
    await chrome.executeJavaScript(
      `localStorage.setItem('rei:shortcuts', 'yt | YouTube | https://www.youtube.com/results?search_query={query}\\ngh | GitHub | https://github.com/search?q={query}&type=code\\nwiki | Wikipedia | https://en.wikipedia.org/w/index.php?search={query}')`
    )
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const sidebar = window.contentView.children[0].webContents
    await waitFor(() => sidebar.getURL() && !sidebar.isLoading(), 'sidebar must load')
    const read = async (script) => {
      try {
        return await chrome.executeJavaScript(script)
      } catch (error) {
        throw new Error(`${script}\n${error.message}`, { cause: error })
      }
    }
    await read('void window.api.onState(state => window.settingsState = state)')
    const state = () => read('window.settingsState')
    await waitFor(async () => (await state())?.tabs.length === 1, 'initial tab must load')
    const originalId = (await state()).activeTabId

    await sidebar.executeJavaScript('document.querySelector(".sidebar-settings").click()')
    await waitFor(() => read('!!document.querySelector(".settings-page")'), 'settings must render')
    assert.equal(
      await read('!!document.querySelector(".settings-page .settings-scroll > .scroll-area")'),
      true,
      'settings must reuse the custom scroll area'
    )
    await waitFor(
      () =>
        read(`(() => {
        const nav = document.querySelector('.settings-sidebar');
        const selected = nav.querySelector('[data-fluid-selected]');
        const indicator = nav.querySelector('.fluid-hover-indicator.selected');
        return selected?.getAttribute('aria-selected') === 'true' &&
          parseFloat(indicator?.style.getPropertyValue('--fluid-hover-width')) > 0;
      })()`),
      'settings navigation must use the shared selection indicator'
    )
    const settingsId = (await state()).activeTabId
    await read(`(() => {
      const target = document.querySelector('#settings-tab-wallpaper');
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
      }));
    })()`)
    await waitFor(
      () => read('!!document.querySelector(".settings-sidebar .fluid-hover-indicator.active")'),
      'pointer movement must activate the shared hover indicator'
    )
    await read(`(() => {
      const area = document.querySelector('.settings-scroll > .scroll-area');
      area.scrollTop = area.scrollHeight;
    })()`)
    await waitFor(
      () =>
        read(
          'document.querySelector(".settings-scroll").classList.contains("scrollbar-visible") && !document.querySelector(".settings-scroll").classList.contains("at-top")'
        ),
      'scrolling must reveal the custom scrollbar and update edge fades'
    )
    await read('document.querySelector(".settings-scroll > .scroll-area").scrollTop = 0')
    assert.equal((await state()).url, 'rei://settings')
    assert.equal((await state()).tabs.find((tab) => tab.id === settingsId).title, 'Settings')
    assert.equal((await state()).tabs.length, 2, 'settings must preserve existing tabs')
    await read('window.api.openSettings()')
    await waitFor(async () => (await state()).activeTabId === settingsId, 'settings must activate')
    assert.equal((await state()).tabs.length, 2, 'settings button must reuse its tab')
    assert.equal(await read('document.activeElement.classList.contains("settings-page")'), true)
    assert.equal(
      await read('document.querySelector(".settings-page").getBoundingClientRect().top'),
      0,
      'settings must not reserve space for the hidden address bar'
    )
    assert.equal(
      await read('getComputedStyle(document.querySelector(".settings-sidebar")).backgroundColor'),
      'rgba(0, 0, 0, 0)',
      'settings navigation must float without a separate background'
    )
    assert.equal(
      await read('document.querySelectorAll(".rei-card .rei-card").length'),
      0,
      'settings must never nest cards'
    )
    assert.deepEqual(
      await read(
        '[...document.querySelectorAll(".settings-content h2")].map(heading => heading.textContent)'
      ),
      [
        'System appearance',
        'Surfaces',
        'Text & accents',
        'Typography',
        'Website typography',
        'Layout',
        'Tabs',
        'Address bar',
        'Scrolling',
        'Hover',
        'Extra'
      ],
      'appearance sections must follow a consistent order'
    )
    assert.equal(
      await read('document.querySelectorAll("#theme-font, #theme-size, #theme-radius").length'),
      3
    )
    assert.equal(
      await read(
        `document.querySelector('#theme-radius').closest('.rei-card').previousElementSibling.textContent`
      ),
      'Layout'
    )
    assert.equal(await read(`document.querySelectorAll('input[type="time"]').length`), 0)
    assert.equal(
      await read(
        `[...document.querySelectorAll('.settings-content button')].at(-1).textContent.trim()`
      ),
      'Reset appearance'
    )
    const selectPalette = async (mode) => {
      window.focus()
      chrome.focus()
      await read(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      await read('document.querySelector("#theme-palette").click()')
      await waitFor(
        () => read('!!document.querySelector("#theme-palette-list")'),
        'palette dropdown must open'
      )
      await read(`document.querySelector('#theme-palette-list [data-value="${mode}"]').click()`)
      await waitFor(
        async () => (await read('window.api.getTheme()')).paletteMode === mode,
        'palette mode must save'
      )
      await waitFor(
        () => read('!document.querySelector("#theme-palette-list")'),
        'palette dropdown must close'
      )
    }
    const expectedDark = browserModule.exports.defaultColors
    const expectedLight = browserModule.exports.lightColors
    assert.equal((await read('window.api.getTheme()')).paletteMode, 'dark')
    for (const mode of ['dark', 'light', 'system']) {
      nativeTheme.themeSource = 'light'
      await selectPalette(mode)
      const expected = mode === 'dark' ? expectedDark : expectedLight
      await waitFor(
        () =>
          read(`document.querySelector('#color-background').value === '${expected.background}'`),
        'colour controls must show the active palette'
      )
      if (mode === 'light' && process.env.REI_THEME_CAPTURES) {
        await read('document.fonts.ready')
        await read(
          'Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))'
        )
        fs.mkdirSync(process.env.REI_THEME_CAPTURES, { recursive: true })
        fs.writeFileSync(
          path.join(process.env.REI_THEME_CAPTURES, 'appearance-light.png'),
          (await chrome.capturePage()).toPNG()
        )
      }
      await read(
        `document.querySelector('#color-accent').value = '#987abc'; document.querySelector('#color-accent').dispatchEvent(new Event('change',{bubbles:true}))`
      )
      await waitFor(
        async () => (await read('window.api.getTheme()')).paletteMode === 'custom',
        'editing a preset must switch to Custom'
      )
      assert.deepEqual(
        (await read('window.api.getTheme()')).colors,
        { ...expected, accent: '#987abc' },
        'editing one colour must preserve every other active colour'
      )
    }
    const savedCustomPalette = (await read('window.api.getTheme()')).colors
    await selectPalette('system')
    nativeTheme.themeSource = 'dark'
    await waitFor(
      () =>
        read(`document.querySelector('#color-background').value === '${expectedDark.background}'`),
      'System must follow live OS changes'
    )
    await selectPalette('light')
    await selectPalette('custom')
    assert.deepEqual(
      (await read('window.api.getTheme()')).colors,
      savedCustomPalette,
      'selecting Custom must restore saved custom colours without overwriting them'
    )
    await selectPalette('dark')
    nativeTheme.themeSource = 'system'
    assert.equal(
      window.contentView.children.find((view) => view.webContents === chrome).getBounds().height,
      window.getContentBounds().height
    )

    await read('document.querySelector("#settings-tab-search").click()')
    await waitFor(
      async () => (await state()).url === 'rei://settings/search',
      'search settings must open'
    )
    await read('document.querySelector(".switch").click()')
    assert.equal(await read('localStorage.getItem("rei:suggestions")'), 'off')
    assert.equal(
      await read('document.querySelector(".switch").getAttribute("aria-checked")'),
      'false'
    )

    await read(`
      document.querySelector('#settings-tab-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    `)
    await waitFor(
      async () => (await state()).url === 'rei://settings/shortcuts',
      'keyboard navigation must open site search'
    )
    assert.equal(await read('document.activeElement.id'), 'settings-tab-shortcuts')
    assert.equal(await read('document.querySelectorAll("[role=tabpanel]:not([hidden])").length'), 1)
    assert.equal(
      await read('document.querySelector("[role=tabpanel]:not([hidden]) h1").textContent'),
      'Site search'
    )
    const sitesFile = path.join(app.getPath('userData'), 'site-search.json')
    assert.equal(
      await read(
        'document.querySelectorAll(".settings-content input, .settings-content textarea").length'
      ),
      0,
      'site search must be a read-only list'
    )
    const initialSites = JSON.parse(fs.readFileSync(sitesFile, 'utf8'))
    assert.equal(initialSites.length, 3)
    assert.equal(
      initialSites[1].url,
      'https://github.com/search?q={query}&type=code',
      'legacy shortcuts must migrate without losing custom URLs'
    )
    let openedSites = ''
    shell.openPath = async (file) => {
      openedSites = file
      return ''
    }
    await read('document.querySelector(".site-actions button").click()')
    await waitFor(() => openedSites === sitesFile, 'site search must open its real JSON file')
    fs.writeFileSync(sitesFile, '{invalid')
    await waitFor(
      () =>
        read(
          'document.querySelector(".settings-content [role=alert]")?.textContent.includes("Could not apply")'
        ),
      'invalid JSON must report an error'
    )
    assert.equal(
      (await read('window.api.getShortcuts()')).length,
      3,
      'invalid file must retain last valid sites'
    )
    await read('document.querySelector(".site-actions button").click()')
    assert.equal(
      fs.readFileSync(sitesFile, 'utf8'),
      '{invalid',
      'opening invalid JSON must not overwrite it'
    )
    const customSites = [
      { keyword: 'gh2', title: 'GitHub', url: 'https://github.com/search?q={query}' }
    ]
    for (const invalid of [
      [...customSites, ...customSites],
      [{ ...customSites[0], url: 'javascript:alert(1){query}' }],
      [{ ...customSites[0], url: 'https://example.com' }],
      [{ ...customSites[0], keyword: 'Invalid Keyword' }],
      Array.from({ length: 31 }, (_, index) => ({ ...customSites[0], keyword: `site${index}` }))
    ]) {
      fs.writeFileSync(sitesFile, JSON.stringify(invalid))
      await new Promise((resolve) => setTimeout(resolve, 650))
      assert.deepEqual(await read('window.api.getShortcuts()'), initialSites)
    }
    fs.writeFileSync(sitesFile, JSON.stringify(customSites))
    await waitFor(
      () =>
        read(
          'document.querySelectorAll(".settings-content .rei-row").length === 1 && document.querySelector(".settings-content code")?.textContent === "gh2" && !document.querySelector(".settings-content [role=alert]")'
        ),
      'valid edits must update the list and clear errors'
    )
    const shortcutResults = await read('window.api.suggest("gh2 visual test", "all", 1, false)')
    assert.equal(
      shortcutResults.results[0].url,
      'https://github.com/search?q=visual%20test',
      'edited sites must be wired into search'
    )
    fs.writeFileSync(sitesFile, '[]')
    await waitFor(
      () =>
        read(
          'document.querySelector(".settings-content .rei-row-title")?.textContent === "No sites added"'
        ),
      'empty JSON array must remove all sites'
    )
    fs.writeFileSync(sitesFile, JSON.stringify(initialSites))
    await waitFor(
      () => read('document.querySelectorAll(".settings-content .rei-row").length === 3'),
      'restored sites must appear'
    )

    await read(
      `document.querySelector('#settings-tab-shortcuts').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))`
    )
    await waitFor(
      async () => (await state()).url === 'rei://settings/privacy',
      'End must open Privacy'
    )
    assert.equal(await read('document.activeElement.id'), 'settings-tab-privacy')

    let confirmationCount = 0
    dialog.showMessageBox = async (_window, options) => {
      assert.equal(options.message, 'Clear search data?')
      confirmationCount += 1
      return { response: confirmationCount === 1 ? 1 : 0 }
    }
    await read('document.querySelector("#clear-search-data").click()')
    await waitFor(
      () =>
        read('document.querySelector("#clear-search-data").getAttribute("aria-busy") !== "true"'),
      'cancel must reset clear button'
    )
    assert.equal(await read('document.querySelector(".feedback").textContent'), '')
    await read('document.querySelector("#clear-search-data").click()')
    await waitFor(
      () => read('document.querySelector(".feedback").textContent.includes("cleared")'),
      'confirmed clear must finish'
    )
    assert.equal(confirmationCount, 2)

    for (const width of [1800, 1000, 480]) {
      window.setSize(width, 760)
      window.emit('resize')
      await waitFor(
        () =>
          read(
            `innerWidth === ${window.getContentBounds().width - (width < 620 ? 150 : 208)} && document.querySelector(".settings-page").getBoundingClientRect().width === innerWidth`
          ),
        'settings must fill content width'
      )
      assert.equal(
        await read(
          'document.querySelector(".settings-page").scrollWidth <= document.querySelector(".settings-page").clientWidth'
        ),
        true,
        'settings must not overflow horizontally'
      )
      for (const section of [
        'appearance',
        'wallpaper',
        'caret',
        'motion',
        'browser',
        'performance',
        'search',
        'shortcuts',
        'keybinds',
        'downloads',
        'privacy'
      ]) {
        await read(`document.querySelector('#settings-tab-${section}').click()`)
        await waitFor(
          () =>
            read(
              `document.querySelector('#settings-tab-${section}').getAttribute('aria-selected') === 'true'`
            ),
          'sidebar must select its page'
        )
        assert.equal(
          await read('document.querySelectorAll(".rei-card .rei-card").length'),
          0,
          'shared cards must never nest'
        )
        assert.equal(
          await read('document.querySelectorAll("select").length'),
          0,
          'all dropdowns must use shared custom controls'
        )
        if (section === 'browser')
          assert.equal(
            await read('document.querySelectorAll(".settings-content .rei-description").length'),
            0,
            'browsing must not show redundant descriptions'
          )
        assert.equal(
          await read(
            'document.querySelector(".settings-content").scrollWidth <= document.querySelector(".settings-content").clientWidth'
          ),
          true,
          `${section} must not overflow at ${width}px`
        )
        assert.equal(
          await read(
            'document.querySelector(".settings-sidebar").getBoundingClientRect().right <= document.querySelector(".settings-content").getBoundingClientRect().left'
          ),
          true,
          'navigation must stay left of content'
        )
        if (width === 1800)
          assert.equal(
            await read(
              'Math.abs(document.querySelector(".settings-content").getBoundingClientRect().left + document.querySelector(".settings-content").getBoundingClientRect().width / 2 - innerWidth / 2) < 1'
            ),
            true,
            'settings content must be centered independently of navigation'
          )
        if (width === 480 && section === 'privacy') {
          assert.equal(
            await read(
              'document.querySelector("#clear-search-data").getBoundingClientRect().top >= document.querySelector("#clear-search-data").closest(".rei-row").querySelector(".rei-row-copy").getBoundingClientRect().bottom'
            ),
            true,
            'narrow cleanup control must sit below its copy instead of squeezing it'
          )
        }
        if (
          process.env.REI_THEME_CAPTURES &&
          (section === 'appearance' ||
            section === 'privacy' ||
            section === 'shortcuts' ||
            section === 'keybinds' ||
            section === 'browser')
        ) {
          await read('document.fonts.ready')
          await read(
            'Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))'
          )
          fs.mkdirSync(process.env.REI_THEME_CAPTURES, { recursive: true })
          fs.writeFileSync(
            path.join(process.env.REI_THEME_CAPTURES, `${section}-${width}.png`),
            (await chrome.capturePage()).toPNG()
          )
          if (section === 'appearance') {
            for (const heading of ['Typography', 'Layout']) {
              await read(
                `[...document.querySelectorAll('.settings-content h2')].find(element => element.textContent === '${heading}').scrollIntoView({block:'start'})`
              )
              await new Promise((resolve) => setTimeout(resolve, 150))
              fs.writeFileSync(
                path.join(
                  process.env.REI_THEME_CAPTURES,
                  `appearance-${heading.toLowerCase()}-${width}.png`
                ),
                (await chrome.capturePage()).toPNG()
              )
            }
            await read(
              'document.querySelector(".settings-scroll > .scroll-area").scrollTop = document.querySelector(".settings-scroll > .scroll-area").scrollHeight'
            )
            await new Promise((resolve) => setTimeout(resolve, 150))
            fs.writeFileSync(
              path.join(process.env.REI_THEME_CAPTURES, `appearance-bottom-${width}.png`),
              (await chrome.capturePage()).toPNG()
            )
            await read('document.querySelector(".settings-scroll > .scroll-area").scrollTop = 0')
          }
        }
        assert.equal(
          await read('document.querySelector(".settings-page").getBoundingClientRect().top'),
          0,
          'all settings pages must fill the top edge'
        )
      }
    }
    await read('window.api.setTheme({fontSize:18})')
    for (const section of [
      'appearance',
      'wallpaper',
      'caret',
      'motion',
      'browser',
      'performance',
      'search',
      'shortcuts',
      'keybinds',
      'downloads',
      'privacy'
    ]) {
      await read(`document.querySelector('#settings-tab-${section}').click()`)
      await waitFor(
        () =>
          read(
            `document.querySelector('#settings-tab-${section}').getAttribute('aria-selected') === 'true'`
          ),
        'large-text page must render'
      )
      assert.equal(
        await read(
          'document.querySelector(".settings-page").scrollWidth <= document.querySelector(".settings-page").clientWidth'
        ),
        true,
        `${section} must fit with large text`
      )
    }
    await read(`window.api.switchTab(${JSON.stringify(originalId)})`)
    await waitFor(
      () => read('!document.querySelector(".settings-page")'),
      'settings must hide when switching tabs'
    )
    await read('window.api.openSettings()')
    await waitFor(() => read('!!document.querySelector(".settings-page")'), 'settings must reopen')
    assert.equal(
      (await state()).url,
      'rei://settings/privacy',
      'gear must preserve selected settings page'
    )
    assert.equal((await state()).tabs.length, 2, 'subpages must reuse the same settings tab')
    assert.equal(await read('localStorage.getItem("rei:suggestions")'), 'off')
    await read(`window.api.closeTab(${JSON.stringify(settingsId)})`)
    await waitFor(async () => (await state()).tabs.length === 1, 'settings tab must close normally')
    await read(`
      const input = document.querySelector('input');
      input.focus();
      input.value = 'REI://settings/';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.address-bar').requestSubmit();
    `)
    await waitFor(
      async () => (await state()).url === 'rei://settings',
      'typed internal URL must bypass search suggestions'
    )
    assert.equal((await state()).activeTabId, originalId, 'typed URL must navigate current tab')
    await waitFor(
      () => read('!!document.querySelector(".settings-page")'),
      'typed settings URL must render'
    )
    await read('window.api.navigate("REI://settings/Privacy/")')
    await waitFor(
      async () => (await state()).url === 'rei://settings/privacy',
      'typed subpage must normalize its URL'
    )
    await waitFor(
      () =>
        read(
          'document.querySelector("#settings-tab-privacy").getAttribute("aria-selected") === "true"'
        ),
      'deep link must select its sidebar page'
    )
    console.log(
      'PASS: settings subpages, keyboard navigation, tab reuse/close/switch, deep links, preferences, shortcut validation/save, confirmed cleanup, compact two-column layouts'
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
