const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  if (!process.versions.electron) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-scrollbar-check-'))
    const ts = require('typescript')
    try {
      for (const [source, output] of [
        ['src/preload/scrollbars.ts', 'preload.js'],
        ['src/shared/theme.ts', 'theme.js'],
        ['src/shared/website-scrollbars.ts', 'website-scrollbars.js']
      ]) {
        const compiled = ts.transpileModule(
          fs.readFileSync(path.join(__dirname, '..', source), 'utf8'),
          {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
          }
        )
        fs.writeFileSync(path.join(directory, output), compiled.outputText)
      }
      const env = { ...process.env, REI_SCROLLBAR_CHECK: directory }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
        env,
        stdio: 'inherit',
        windowsHide: true,
        timeout: 30000
      })
      if (result.error) throw result.error
      assert.equal(result.status, 0, 'Website scrollbar checks failed')
    } finally {
      assert.equal(path.dirname(directory), os.tmpdir())
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 })
    }
    return
  }

  const { app, BrowserWindow } = require('electron')
  const directory = process.env.REI_SCROLLBAR_CHECK
  const { websiteScrollbarCSS } = require(path.join(directory, 'website-scrollbars.js'))
  const { defaultTheme } = require(path.join(directory, 'theme.js'))
  app.setPath('userData', path.join(directory, 'profile'))
  const fixture = `<!doctype html><html><head><style>
    body { margin: 0; min-height: 2000px; }
    .scroller { width: 160px; height: 100px; overflow: auto; }
    .content { width: 400px; height: 400px; }
    #themed::-webkit-scrollbar { width: 13px; }
    #themed::-webkit-scrollbar-thumb { background: rgb(255, 0, 0); border-radius: 0; }
    #themed::-webkit-scrollbar-track { background: rgb(0, 0, 255); }
    #standard { scrollbar-color: rgb(0, 128, 0) rgb(0, 0, 255); scrollbar-width: thin; }
    #color-only { scrollbar-color: rgb(160, 80, 40) rgb(20, 10, 5); }
    #hidden::-webkit-scrollbar { display: none; }
    #thumb-only::-webkit-scrollbar-thumb { background: rgb(255, 0, 128); }
    @layer site { #layered::-webkit-scrollbar-thumb { background: rgb(128, 0, 255); } }
    </style></head><body>
    <div id="plain" class="scroller"><div class="content"></div></div>
    <div id="themed" class="scroller"><div class="content"></div></div>
    <div id="standard" class="scroller"><div class="content"></div></div>
    <div id="color-only" class="scroller"><div class="content"></div></div>
    <div id="hidden" class="scroller"><div class="content"></div></div>
    <div id="thumb-only" class="scroller"><div class="content"></div></div>
    <div id="layered" class="scroller"><div class="content"></div></div>
    </body></html>`
  const server = require('node:http').createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(
      request.url === '/color-only'
        ? fixture.replace(
            '</style>',
            'html { scrollbar-color: rgb(170, 170, 170) rgb(15, 15, 15); }</style>'
          )
        : fixture
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  await app.whenReady()
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(directory, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  try {
    const contents = window.webContents
    const url = `http://127.0.0.1:${server.address().port}`
    await window.loadURL(url)
    let cssKey
    const apply = async (patch = {}) => {
      if (cssKey) await contents.removeInsertedCSS(cssKey)
      cssKey = await contents.insertCSS(websiteScrollbarCSS({ ...defaultTheme, ...patch }, true), {
        cssOrigin: 'user'
      })
    }
    const read = (selector, pseudo, property) =>
      contents.executeJavaScript(
        `getComputedStyle(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(pseudo)}).getPropertyValue(${JSON.stringify(property)})`
      )
    const active = (selector) =>
      contents.executeJavaScript(
        `document.querySelector(${JSON.stringify(selector)}).hasAttribute('data-rei-scrollbar-active')`
      )
    const waitFor = async (expression, message) => {
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        if (await contents.executeJavaScript(expression)) return
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.fail(message)
    }
    await apply()
    assert.equal(await read('#plain', '::-webkit-scrollbar', 'width'), '6px')
    assert.equal(await read('html', '::-webkit-scrollbar', 'width'), '6px')
    assert.equal(
      await contents.executeJavaScript('innerWidth - document.documentElement.clientWidth'),
      6,
      'The rendered scrollbar must actually be six pixels wide'
    )
    assert.equal(
      await read('#plain', '::-webkit-scrollbar-thumb', 'background-color'),
      'rgba(0, 0, 0, 0)'
    )
    await contents.executeJavaScript(`document.querySelector('#plain').scrollTop = 30;
      document.querySelector('#plain').dispatchEvent(new Event('scroll'));
      document.dispatchEvent(new Event('scroll'))`)
    assert.equal(await active('#plain'), true)
    assert.equal(await active('html'), true)
    assert.notEqual(
      await read('#plain', '::-webkit-scrollbar-thumb', 'background-color'),
      'rgba(0, 0, 0, 0)'
    )
    await new Promise((resolve) => setTimeout(resolve, 2200))
    assert.equal(await active('#plain'), false)
    assert.equal(await active('html'), false)
    await contents.executeJavaScript(
      `document.querySelector('#plain').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 159, clientY: 40 }))`
    )
    assert.equal(await active('#plain'), true)
    for (const visibility of ['auto', 'always', 'hidden']) {
      await apply({ scrollbarVisibility: visibility, scrollbarWidth: 9 })
      await contents.executeJavaScript(
        `for (const element of document.querySelectorAll('.scroller')) element.setAttribute('data-rei-scrollbar-active', '')`
      )
      assert.equal(
        await read('#plain', '::-webkit-scrollbar', 'width'),
        visibility === 'hidden' ? '0px' : '9px'
      )
      assert.equal(await read('#themed', '::-webkit-scrollbar', 'width'), '13px')
      assert.equal(
        await read('#themed', '::-webkit-scrollbar-thumb', 'background-color'),
        'rgb(255, 0, 0)'
      )
      assert.equal(
        await read('#themed', '::-webkit-scrollbar-track', 'background-color'),
        'rgb(0, 0, 255)'
      )
      assert.equal(
        await read('#standard', null, 'scrollbar-color'),
        'rgb(0, 128, 0) rgb(0, 0, 255)'
      )
      assert.equal(await read('#standard', null, 'scrollbar-width'), 'thin')
      assert.equal(await read('#hidden', '::-webkit-scrollbar', 'display'), 'none')
      assert.equal(
        await read('#thumb-only', '::-webkit-scrollbar-thumb', 'background-color'),
        'rgb(255, 0, 128)'
      )
      assert.equal(
        await read('#layered', '::-webkit-scrollbar-thumb', 'background-color'),
        'rgb(128, 0, 255)'
      )
    }
    await apply({
      scrollbarVisibility: 'always',
      colors: { ...defaultTheme.colors, scrollbar: '#123456' },
      paletteMode: 'custom'
    })
    const previousColor = await read('#plain', '::-webkit-scrollbar-thumb', 'background-color')
    await apply({
      scrollbarVisibility: 'always',
      colors: { ...defaultTheme.colors, scrollbar: '#abcdef' },
      paletteMode: 'custom'
    })
    assert.notEqual(
      await read('#plain', '::-webkit-scrollbar-thumb', 'background-color'),
      previousColor
    )
    await contents.executeJavaScript(`const style = document.createElement('style');
      style.textContent = '#plain::-webkit-scrollbar { width: 12px; } #plain::-webkit-scrollbar-thumb { background: rgb(255, 128, 0); }';
      document.head.append(style)`)
    await contents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    assert.equal(
      await read('#plain', '::-webkit-scrollbar-thumb', 'background-color'),
      'rgb(255, 128, 0)'
    )
    contents.debugger.attach('1.3')
    await apply()
    assert.equal(await read('html', '::-webkit-scrollbar', 'width'), '6px')
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }]
    })
    assert.notEqual(await read('html', '::-webkit-scrollbar', 'width'), '6px')
    contents.debugger.detach()
    await window.loadURL(url + '/next')
    await apply()
    assert.equal(await active('html'), false)
    assert.equal(await read('html', '::-webkit-scrollbar', 'width'), '6px')
    await window.loadURL(url + '/color-only')
    await apply()
    assert.equal(
      await contents.executeJavaScript('innerWidth - document.documentElement.clientWidth'),
      6,
      'A website setting only scrollbar colors must not restore the wide native scrollbar'
    )
    assert.equal(await read('html', '::-webkit-scrollbar-button', 'display'), 'none')
    assert.equal(
      await read('html', '::-webkit-scrollbar-track', 'background-color'),
      'rgb(15, 15, 15)'
    )
    assert.equal(
      await read('html', '::-webkit-scrollbar-thumb', 'background-color'),
      'rgba(0, 0, 0, 0)'
    )
    await contents.executeJavaScript(`document.dispatchEvent(new Event('scroll'));
      document.querySelector('#color-only').dispatchEvent(new Event('scroll'))`)
    assert.equal(
      await read('html', '::-webkit-scrollbar-thumb', 'background-color'),
      'rgb(170, 170, 170)'
    )
    assert.equal(
      await contents.executeJavaScript(
        `document.querySelector('#color-only').offsetWidth - document.querySelector('#color-only').clientWidth`
      ),
      6
    )
    assert.equal(
      await read('#color-only', '::-webkit-scrollbar-thumb', 'background-color'),
      'rgb(160, 80, 40)'
    )
    await new Promise((resolve) => setTimeout(resolve, 2200))
    assert.equal(
      await read('html', '::-webkit-scrollbar-thumb', 'background-color'),
      'rgba(0, 0, 0, 0)'
    )
    await contents.executeJavaScript(
      `document.documentElement.style.setProperty('scrollbar-color', 'rgb(32, 64, 96) rgb(8, 9, 10)', 'important')`
    )
    await waitFor(
      `document.documentElement.style.getPropertyValue('--rei-website-scrollbar-thumb') === 'rgb(32, 64, 96)'`,
      'Website theme changes must update the custom thumb'
    )
    await contents.executeJavaScript(`document.dispatchEvent(new Event('scroll'))`)
    assert.equal(
      await read('html', '::-webkit-scrollbar-thumb', 'background-color'),
      'rgb(32, 64, 96)'
    )
    assert.equal(
      await read('html', '::-webkit-scrollbar-track', 'background-color'),
      'rgb(8, 9, 10)'
    )
    assert.equal(
      await contents.executeJavaScript('innerWidth - document.documentElement.clientWidth'),
      6
    )
    await contents.executeJavaScript(`document.documentElement.style.scrollbarWidth = 'thin'`)
    await waitFor(
      `!document.documentElement.hasAttribute('data-rei-scrollbar-colors')`,
      'An explicit website scrollbar width must take over'
    )
    assert.equal(await read('html', null, 'scrollbar-color'), 'rgb(32, 64, 96) rgb(8, 9, 10)')
    await contents.executeJavaScript(`document.documentElement.style.scrollbarWidth = 'none'`)
    assert.equal(
      await contents.executeJavaScript('innerWidth - document.documentElement.clientWidth'),
      0
    )
    await contents.executeJavaScript(`document.documentElement.style.scrollbarWidth = 'auto'`)
    await waitFor(
      `document.documentElement.hasAttribute('data-rei-scrollbar-colors')`,
      'Returning to default width must restore Rei styling'
    )
    assert.equal(
      await contents.executeJavaScript('innerWidth - document.documentElement.clientWidth'),
      6
    )
    await contents.executeJavaScript(`document.documentElement.style.removeProperty('scrollbar-color');
      const theme = document.createElement('style');
      theme.textContent = 'html[data-dark] { scrollbar-color: rgb(64, 96, 128) rgb(0, 0, 0); }';
      document.head.append(theme); document.documentElement.setAttribute('data-dark', '')`)
    await waitFor(
      `document.documentElement.style.getPropertyValue('--rei-website-scrollbar-thumb') === 'rgb(64, 96, 128)'`,
      'Late stylesheets and theme attributes must be respected'
    )
    await apply({ scrollbarVisibility: 'hidden' })
    assert.equal(
      await contents.executeJavaScript('innerWidth - document.documentElement.clientWidth'),
      0
    )
    await apply({ scrollbarVisibility: 'always', scrollbarWidth: 9 })
    assert.equal(
      await contents.executeJavaScript('innerWidth - document.documentElement.clientWidth'),
      9
    )
    assert.equal(
      await read('html', '::-webkit-scrollbar-thumb', 'background-color'),
      'rgb(64, 96, 128)'
    )
    await apply()
    contents.debugger.attach('1.3')
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }]
    })
    await waitFor(
      `!document.documentElement.hasAttribute('data-rei-scrollbar-colors')`,
      'Forced colors must restore native accessibility styling'
    )
    assert.notEqual(
      await contents.executeJavaScript('innerWidth - document.documentElement.clientWidth'),
      6
    )
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'none' }]
    })
    await waitFor(
      `document.documentElement.hasAttribute('data-rei-scrollbar-colors')`,
      'Leaving forced colors must restore Rei styling'
    )
    assert.equal(
      await contents.executeJavaScript('innerWidth - document.documentElement.clientWidth'),
      6
    )
    contents.debugger.detach()
    console.log(
      'Website scrollbar fallback, activity, theme updates, author precedence, accessibility, and navigation checks passed.'
    )
  } finally {
    window.destroy()
    await new Promise((resolve) => server.close(resolve))
    app.quit()
  }
}

main().catch((error) => {
  console.error(error)
  if (process.versions.electron) require('electron').app.exit(1)
  else process.exitCode = 1
})
