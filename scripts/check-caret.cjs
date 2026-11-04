const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-caret-check-'))
  let status = 0
  try {
    for (const phase of ['write', 'restart']) {
      const env = { ...process.env, REI_CARET_PROFILE: profile, REI_CARET_PHASE: phase }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
        env,
        stdio: 'inherit',
        timeout: 45000,
        windowsHide: true
      })
      if (result.error) console.error(result.error)
      if (result.status !== 0) {
        status = result.status ?? 1
        break
      }
    }
  } finally {
    assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-caret-check-')))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  }
  process.exit(status)
}

const { app, BaseWindow } = require('electron')
const intervals = []
const nativeSetInterval = global.setInterval
global.setInterval = (...args) => {
  const timer = nativeSetInterval(...args)
  intervals.push(timer)
  return timer
}
process.on('uncaughtException', (error) => {
  console.error(error.stack)
  app.exit(1)
})
process.on('unhandledRejection', (error) => {
  console.error(error)
  app.exit(1)
})
const Module = require('node:module')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.setPath('userData', process.env.REI_CARET_PROFILE)
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
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(message)
}

app.whenReady().then(async () => {
  const store = new browserModule.exports.SearchStore(':memory:')
  const window = new BaseWindow({ width: 1200, height: 800, show: true })
  try {
    const chrome = browserModule.exports.attachBrowser(window, store)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const read = (script) => chrome.executeJavaScript(script)
    const frames = () =>
      read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const theme = () => read('window.api.getTheme()')
    await waitFor(() => read('!!document.querySelector(".blank-page")'), 'renderer mounts')
    await read('window.api.navigate("rei://settings/caret")')
    await waitFor(
      () => read('!!document.querySelector(".caret-preview input")'),
      'caret settings mount'
    )
    window.focus()
    chrome.focus()
    if (process.env.REI_CARET_PHASE === 'restart') {
      const restored = await theme()
      assert.equal(restored.caretMoveDuration, 120)
      assert.equal(restored.caretSmoothTyping, true)
      assert.equal(restored.selectionSmooth, false)
      assert.equal(restored.selectionRadius, 6)
      await read(
        '[...document.querySelectorAll("button")].find(button => button.textContent.includes("Reset caret")).click()'
      )
      await waitFor(async () => (await theme()).caretMoveDuration === 90, 'reset restores duration')
      const reset = await theme()
      assert.equal(reset.caretSmoothTyping, false)
      assert.equal(reset.selectionSmooth, true)
      assert.equal(reset.selectionRadius, 3)
      console.log('PASS: new caret/selection settings survive restart and reset together')
      return
    }

    for (const patch of [
      { caretMoveDuration: -1 },
      { caretMoveDuration: 201 },
      { caretMoveDuration: 1.5 },
      { caretSmoothTyping: 'yes' },
      { selectionSmooth: 1 },
      { selectionRadius: 9 }
    ]) {
      assert.equal(
        await read(`window.api.setTheme(${JSON.stringify(patch)}).then(() => true, () => false)`),
        false
      )
    }
    await read(
      'window.api.setTheme({motion:"none",caretBlink:true,caretBlinkInterval:300,colors:{accent:"#abcdef",accentText:"#123456"}})'
    )
    await read(
      'window.testInput=document.querySelector(".caret-preview input");window.testInput.focus();window.testInput.value="AV office W i";window.testInput.setSelectionRange(13,13);window.testInput.dispatchEvent(new Event("input",{bubbles:true}))'
    )
    await frames()
    const geometry = await read(`(() => {
      const input=window.testInput, caret=input.parentElement.querySelector('.custom-caret');
      const style=getComputedStyle(input), context=document.createElement('canvas').getContext('2d');
      context.font=style.font;
      return {position:parseFloat(caret.style.getPropertyValue('--caret-x')), expected:parseFloat(style.paddingLeft)+context.measureText(input.value).width, focused:caret.classList.contains('focused')};
    })()`)
    assert.ok(Math.abs(geometry.position - geometry.expected) < 1, JSON.stringify(geometry))
    assert.equal(geometry.focused, true)
    await read('window.testInput.setSelectionRange(1,7,"backward")')
    await frames()
    const selection = await read(`(() => {
      const root=window.testInput.parentElement, highlight=root.querySelector('.custom-highlight');
      return {width:parseFloat(highlight.style.width), focused:root.querySelector('.custom-caret').classList.contains('focused'), radius:getComputedStyle(highlight).borderRadius, text:window.testInput.value.slice(window.testInput.selectionStart,window.testInput.selectionEnd), pointer:getComputedStyle(highlight.parentElement).pointerEvents, background:getComputedStyle(highlight).backgroundColor, selectedColor:getComputedStyle(window.testInput,'::selection').color};
    })()`)
    assert.ok(selection.width > 20)
    assert.equal(selection.focused, false, 'hide insertion caret while selecting')
    assert.equal(selection.radius, '3px')
    assert.equal(selection.text, 'V offi')
    assert.equal(selection.pointer, 'none')
    assert.equal(selection.background, 'rgb(171, 205, 239)', 'highlight uses themed accent')
    assert.equal(selection.selectedColor, 'rgb(18, 52, 86)', 'selected text uses themed on-accent')
    await read('window.testInput.setSelectionRange(2,8,"forward")')
    await frames()
    assert.equal(
      await read('document.querySelectorAll(".caret-preview .custom-highlight").length'),
      1
    )

    await read(
      'window.testInput.value="abc \\u05d0\\u05d1\\u05d2 def";window.testInput.setSelectionRange(1,6);window.testInput.dispatchEvent(new Event("input"))'
    )
    await frames()
    assert.ok(
      await read('document.querySelectorAll(".caret-preview .custom-highlight").length >= 2'),
      'mixed-direction selections preserve separate runs'
    )
    await read(
      'window.testInput.value="long address ".repeat(100);window.testInput.setSelectionRange(window.testInput.value.length,window.testInput.value.length);window.testInput.dispatchEvent(new Event("input"))'
    )
    await frames()
    await read(
      'window.testInput.scrollLeft=window.testInput.scrollWidth;window.testInput.dispatchEvent(new Event("scroll"))'
    )
    await frames()
    assert.ok(await read('window.testInput.scrollLeft > 0'), 'fixture horizontally scrolls')
    assert.ok(
      await read(
        'parseFloat(document.querySelector(".caret-preview .custom-caret").style.getPropertyValue("--caret-x")) <= window.testInput.clientWidth'
      ),
      'caret follows native horizontal scroll'
    )
    assert.equal(
      await read(
        'getComputedStyle(document.querySelector(".caret-preview .custom-caret")).transitionDuration'
      ),
      '0s'
    )

    await read('window.testInput.dispatchEvent(new CompositionEvent("compositionstart"))')
    await frames()
    assert.equal(await read('window.testInput.classList.contains("native-editing")'), true)
    assert.equal(
      await read(
        'document.querySelector(".caret-preview .custom-caret").classList.contains("focused")'
      ),
      false
    )
    await read('window.testInput.dispatchEvent(new CompositionEvent("compositionend"))')
    await frames()
    assert.equal(await read('window.testInput.classList.contains("native-editing")'), false)
    await read('window.api.setTheme({motion:"system"})')
    await frames()
    await read(
      'document.documentElement.dataset.motion="full";window.testInput.value="Caret test";window.testInput.setSelectionRange(10,10);window.testInput.dispatchEvent(new Event("input"))'
    )
    await frames()
    assert.equal(
      await read(
        'getComputedStyle(document.querySelector(".caret-preview .custom-caret")).transitionDuration'
      ),
      '0s',
      'typing snaps by default'
    )
    await read('window.testInput.setSelectionRange(3,3)')
    await frames()
    assert.equal(
      await read(
        'getComputedStyle(document.querySelector(".caret-preview .custom-caret")).transitionDuration'
      ),
      '0.09s',
      'navigation animates'
    )
    await waitFor(
      () =>
        read(
          'document.querySelector(".caret-preview .custom-caret").classList.contains("blinking")'
        ),
      'idle caret starts blinking'
    )
    await read('window.testInput.dispatchEvent(new KeyboardEvent("keyup",{key:"Shift"}))')
    await frames()
    assert.equal(
      await read(
        'document.querySelector(".caret-preview .custom-caret").classList.contains("blinking")'
      ),
      true,
      'unrelated keyup does not reset blink'
    )
    await read('window.api.setTheme({motion:"reduced"});window.testInput.setSelectionRange(1,6)')
    await frames()
    assert.ok(
      !(
        await read(
          'getComputedStyle(document.querySelector(".caret-preview .custom-highlight")).transitionProperty'
        )
      ).includes('transform'),
      'reduced motion suppresses spatial animation'
    )
    await read('window.testInput.blur()')
    await frames()
    await waitFor(
      () => read('document.querySelectorAll(".caret-preview .custom-highlight").length === 0'),
      'blur clears selection overlay'
    )

    chrome.debugger.attach('1.3')
    try {
      await chrome.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'forced-colors', value: 'active' }]
      })
      await frames()
      assert.equal(
        await read(
          'getComputedStyle(document.querySelector(".caret-preview .text-overlay")).display'
        ),
        'none'
      )
      assert.notEqual(
        await read('getComputedStyle(window.testInput).caretColor'),
        'rgba(0, 0, 0, 0)',
        'forced colours restore native caret'
      )
    } finally {
      await chrome.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
      chrome.debugger.detach()
    }

    await read(
      'document.querySelector("#caret-smooth-typing").click();document.querySelector("#selection-smooth").click();for(const [id,value] of [["caret-move-duration",120],["selection-radius",6]]){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}))}'
    )
    await waitFor(async () => {
      const value = await theme()
      return (
        value.caretSmoothTyping &&
        !value.selectionSmooth &&
        value.caretMoveDuration === 120 &&
        value.selectionRadius === 6
      )
    }, 'new settings controls persist')
    await read(
      'window.api.setTheme({motion:"system"});window.testInput.focus();window.testInput.setSelectionRange(0,4)'
    )
    await frames()
    assert.equal(
      await read(
        'getComputedStyle(document.querySelector(".caret-preview .custom-highlight")).transitionDuration'
      ),
      '0s',
      'selection animation switch works'
    )

    await read('window.api.newTab()')
    await waitFor(
      () => read('!!document.querySelector(".blank-page")'),
      'leaving settings disposes preview'
    )
    await frames()
    assert.equal(
      await read('document.querySelectorAll(".text-overlay").length'),
      1,
      'only address overlay remains'
    )
    await read(
      'window.addressTest=document.querySelector(".address-bar input");window.addressTest.focus();window.addressTest.value="Rei address";window.addressTest.setSelectionRange(0,3);window.addressTest.dispatchEvent(new Event("select"))'
    )
    await frames()
    assert.equal(
      await read('document.querySelectorAll(".address-bar .custom-highlight").length'),
      1,
      'address bar uses shared selection renderer'
    )
    console.log(
      'PASS: caret shaping, navigation/typing timing, selections, bidi, scrolling, IME fallback, blink, reduced motion, controls, cleanup'
    )
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    for (const timer of intervals) clearInterval(timer)
    window.removeAllListeners('closed')
    app.exit(process.exitCode ?? 0)
  }
})
