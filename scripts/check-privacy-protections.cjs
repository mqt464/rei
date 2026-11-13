const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-protections-check-'))
  let status = 1
  try {
    for (const blocked of [true, false]) {
      fs.writeFileSync(
        path.join(profile, 'preferences.json'),
        JSON.stringify({ blockThirdPartyCookies: blocked })
      )
      const env = {
        ...process.env,
        REI_PROTECTIONS_PROFILE: profile,
        REI_COOKIE_BLOCKED: String(blocked)
      }
      delete env.ELECTRON_RUN_AS_NODE
      const flags = blocked
        ? ['--enable-features=ForceThirdPartyCookieBlockingEnabled,ThirdPartyStoragePartitioning']
        : [
            '--enable-features=ThirdPartyStoragePartitioning',
            '--disable-features=ForceThirdPartyCookieBlockingEnabled'
          ]
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, ...flags],
        {
          env,
          stdio: 'inherit',
          timeout: 90000,
          windowsHide: true
        }
      )
      if (result.error) console.error(result.error)
      status = result.status ?? 1
      if (status !== 0) break
    }
  } finally {
    assert.equal(path.dirname(profile), os.tmpdir())
    assert.ok(path.basename(profile).startsWith('rei-protections-check-'))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  }
  process.exit(status)
}

const { app, BaseWindow, session } = require('electron')
const { createServer } = require('node:http')
const Module = require('node:module')
app.setPath('userData', process.env.REI_PROTECTIONS_PROFILE)
app.commandLine.appendSwitch(
  'host-resolver-rules',
  'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'
)
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.on('window-all-closed', () => {})
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const loaded = new Module(bundlePath, module)
loaded.filename = bundlePath
loaded.paths = Module._nodeModulePaths(path.dirname(bundlePath))
loaded._compile(
  fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0] +
    '\nmodule.exports = { attachBrowser, SearchStore, ExtensionRuntime, currentPreferences, setExtensionDoNotTrack, cleanTrackingUrl }',
  bundlePath
)
const cookieBlocked = process.env.REI_COOKIE_BLOCKED === 'true'

async function waitFor(check, message) {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  assert.fail(message)
}

app.whenReady().then(async () => {
  const window = new BaseWindow({ width: 900, height: 760, show: false })
  const store = new loaded.exports.SearchStore(':memory:')
  const requests = []
  let port
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`)
    requests.push({ url, cookie: request.headers.cookie ?? '', method: request.method })
    response.setHeader('Content-Type', 'text/html')
    if (url.pathname === '/seed') {
      response.setHeader('Set-Cookie', 'unpartitioned=seed; SameSite=None; Secure; Path=/')
      response.end('<title>First-party cookies</title>')
    } else if (url.pathname === '/embed') {
      response.end(
        `<script>window.cookieResult=null;addEventListener('message',event=>{if(event.origin==='http://localhost:${port}')window.cookieResult=event.data})</script><iframe src="http://localhost:${port}/third?run=${url.searchParams.get('run')}"></iframe>`
      )
    } else if (url.pathname === '/third') {
      response.setHeader('Set-Cookie', [
        'unpartitioned=server; SameSite=None; Secure; Path=/',
        'partitioned=server; SameSite=None; Secure; Partitioned; Path=/'
      ])
      response.end(
        `<script>document.cookie='thirdJs=written; SameSite=None; Secure; Path=/';parent.postMessage({cookie:document.cookie},'http://127.0.0.1:${port}')</script>`
      )
    } else if (url.pathname === '/consent') {
      response.end(
        `<title>Consent fixture</title><div id="CybotCookiebotDialog"><input type="checkbox" id="CybotCookiebotDialogBodyLevelButtonPreferences" checked><input type="checkbox" id="CybotCookiebotDialogBodyLevelButtonStatistics" checked><input type="checkbox" id="CybotCookiebotDialogBodyLevelButtonMarketing" checked><button id="CybotCookiebotDialogBodyButtonAcceptSelected">Save choices</button><button id="accept-all">Accept all</button></div><script>window.savedChoices=null;window.acceptedAll=false;document.querySelector('#accept-all').onclick=()=>window.acceptedAll=true;document.querySelector('#CybotCookiebotDialogBodyButtonAcceptSelected').onclick=()=>{window.savedChoices=Array.from(document.querySelectorAll('input'),input=>input.checked);document.querySelector('#CybotCookiebotDialog').remove()}</script>`
      )
    } else if (url.pathname === '/unsupported') {
      response.end(
        '<div id="onetrust-banner-sdk"><button id="onetrust-accept-btn-handler" onclick="window.acceptedAll=true">Accept all</button></div>'
      )
    } else if (url.pathname === '/unsafe-consent') {
      response.end(
        '<div id="CybotCookiebotDialog"><button id="CybotCookiebotDialogBodyButtonAccept" onclick="window.acceptedAll=true">Accept all</button></div>'
      )
    } else if (url.pathname === '/consent-frame') {
      response.end('<iframe src="/consent"></iframe>')
    } else
      response.end(
        '<title>Privacy fixture</title><a href="/destination?utm_source=fixture&amp;keep=yes">Tracked link</a>'
      )
  })
  try {
    const clean = loaded.exports.cleanTrackingUrl
    for (const [input, expected] of [
      [
        'https://example.com/?utm_source=mail&keep=a%20b&fbclid=id#section',
        'https://example.com/?keep=a%20b#section'
      ],
      [
        'https://example.com/?UTM_campaign=test&keep=one&keep=two',
        'https://example.com/?keep=one&keep=two'
      ],
      ['https://example.com/?utm_source=test#section', 'https://example.com/#section'],
      [
        'https://example.com/?X-Amz-Signature=abc&utm_source=mail',
        'https://example.com/?X-Amz-Signature=abc&utm_source=mail'
      ],
      [
        'https://example.com/?%73ig=abc&utm_source=mail',
        'https://example.com/?%73ig=abc&utm_source=mail'
      ],
      [
        'https://example.com/?q=search&ref=account&token=secret',
        'https://example.com/?q=search&ref=account&token=secret'
      ],
      ['https://example.com/?bad%escape=x&utm_source=mail', 'https://example.com/?bad%escape=x'],
      ['mailto:user@example.com?utm_source=mail', 'mailto:user@example.com?utm_source=mail'],
      ['not a URL', 'not a URL']
    ])
      assert.equal(clean(input), expected)

    await new Promise((resolve) => server.listen(0, resolve))
    port = server.address().port
    const origin = `http://127.0.0.1:${port}`
    const initial = loaded.exports.currentPreferences()
    for (const key of ['globalPrivacyControl', 'autoRejectConsent', 'cleanTrackingLinks'])
      assert.equal(initial[key], true)
    assert.equal(initial.blockThirdPartyCookies, cookieBlocked)
    await loaded.exports.setExtensionDoNotTrack(
      initial.doNotTrack,
      initial.globalPrivacyControl,
      initial.cleanTrackingLinks
    )
    const extensions = new loaded.exports.ExtensionRuntime()
    await extensions.initialize()
    const chrome = loaded.exports.attachBrowser(window, store, extensions)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const read = (expression) => chrome.executeJavaScript(expression)
    await waitFor(() => read('!!window.api'), 'Rei UI must mount')
    const set = (value) => read(`window.api.setPreferences(${JSON.stringify(value)})`)
    for (const key of ['autoRejectConsent', 'cleanTrackingLinks', 'blockThirdPartyCookies']) {
      assert.equal(
        await read(`window.api.setPreferences({${key}:"yes"}).then(()=>true,()=>false)`),
        false
      )
    }
    await read('window.api.navigate("rei://settings/privacy")')
    await waitFor(
      () => read('!!document.getElementById("autoRejectConsent")'),
      'Privacy settings must mount'
    )
    for (const width of [900, 480]) {
      window.setSize(width, 760)
      for (const key of [
        'autoRejectConsent',
        'cleanTrackingLinks',
        'blockThirdPartyCookies',
        'global-privacy-control'
      ]) {
        const description = await read(
          `document.getElementById(${JSON.stringify(key)}).closest('.rei-row').querySelector('.rei-description')?.textContent ?? ''`
        )
        assert.ok(
          description.trim().length <= 48,
          'new privacy settings must keep descriptions short'
        )
        assert.equal(
          await read(
            `(()=>{const button=document.getElementById(${JSON.stringify(key)});button.focus();return button.getAttribute('role')==='switch'&&document.activeElement===button&&!!document.querySelector('label[for="'+button.id+'"]')})()`
          ),
          true
        )
      }
      assert.equal(await read('document.documentElement.scrollWidth <= innerWidth'), true)
    }
    window.setSize(900, 760)
    const captureDirectory = path.resolve(__dirname, '../.cache/privacy-protections')
    fs.mkdirSync(captureDirectory, { recursive: true })
    if (process.env.REI_CAPTURE_PRIVACY === '1') {
      window.showInactive()
      await new Promise((resolve) => setTimeout(resolve, 250))
      fs.writeFileSync(
        path.join(captureDirectory, 'settings.png'),
        (await chrome.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
      )
      window.hide()
    }

    for (const incognito of [false, true]) {
      const previous = new Set(window.contentView.children.map((view) => view.webContents.id))
      await read(incognito ? 'window.api.newIncognitoTab()' : 'window.api.newTab()')
      let site
      await waitFor(() => {
        site = window.contentView.children.find(
          (view) => !previous.has(view.webContents.id)
        )?.webContents
        return !!site
      }, 'Website tab must open')
      assert.equal(site.session === session.defaultSession, !incognito)
      const navigate = async (address) => {
        await read(`window.api.navigate(${JSON.stringify(address)})`)
        await waitFor(
          async () => !site.isLoading() && site.getURL() === address,
          `Navigation must finish: ${address}`
        )
      }
      for (const enabled of [true, false]) {
        await set({ cleanTrackingLinks: enabled })
        const requested = `${origin}/destination?utm_source=fixture&keep=yes`
        const expected = enabled ? `${origin}/destination?keep=yes` : requested
        const start = requests.length
        await read(`window.api.navigate(${JSON.stringify(requested)})`)
        try {
          await waitFor(
            () => site.getURL() === expected && !site.isLoading(),
            'Tracking links must follow setting'
          )
        } catch (error) {
          console.error({
            incognito,
            enabled,
            expected,
            actual: site.getURL(),
            requests: requests.slice(start).map((entry) => entry.url.href)
          })
          throw error
        }
        const navigation = requests
          .slice(start)
          .find((entry) => entry.url.pathname === '/destination')
        assert.equal(navigation.url.searchParams.has('utm_source'), !enabled)
      }
      await set({ cleanTrackingLinks: true, autoRejectConsent: true })
      await navigate(`${origin}/consent`)
      await waitFor(
        () => site.executeJavaScript('window.savedChoices !== null'),
        'Supported consent must save rejection'
      )
      assert.deepEqual(await site.executeJavaScript('window.savedChoices'), [false, false, false])
      assert.equal(await site.executeJavaScript('window.acceptedAll'), false)
      assert.equal(
        await site.executeJavaScript(
          '!!document.querySelector(".ConsentOMatic-Progress-Dialog-Modal")'
        ),
        false
      )
      await navigate(`${origin}/consent-frame`)
      await waitFor(
        () =>
          site.executeJavaScript(
            'document.querySelector("iframe").contentWindow.savedChoices?.length === 3'
          ),
        'Website frames must reject consent'
      )
      assert.deepEqual(
        await site.executeJavaScript('document.querySelector("iframe").contentWindow.savedChoices'),
        [false, false, false]
      )
      await set({ autoRejectConsent: false })
      await navigate(`${origin}/consent?disabled=1`)
      await new Promise((resolve) => setTimeout(resolve, 900))
      assert.equal(await site.executeJavaScript('window.savedChoices'), null)
      await set({ autoRejectConsent: true })
      await waitFor(
        () => site.executeJavaScript('window.savedChoices !== null'),
        'Enabling consent rejection must affect open pages'
      )
      await navigate(`${origin}/unsupported`)
      await new Promise((resolve) => setTimeout(resolve, 900))
      assert.equal(await site.executeJavaScript('!!window.acceptedAll'), false)
      assert.equal(
        await site.executeJavaScript(
          'document.querySelector("#onetrust-banner-sdk").offsetHeight > 0'
        ),
        true
      )
      await navigate(`${origin}/unsafe-consent`)
      await new Promise((resolve) => setTimeout(resolve, 900))
      assert.equal(await site.executeJavaScript('!!window.acceptedAll'), false)
      assert.equal(
        await site.executeJavaScript(
          'document.querySelector("#CybotCookiebotDialog").offsetHeight > 0'
        ),
        true
      )

      await navigate(`http://localhost:${port}/seed`)
      await waitFor(
        async () => (await site.session.cookies.get({ name: 'unpartitioned' })).length > 0,
        'First-party cookies must remain supported'
      )
      for (const enabled of [cookieBlocked]) {
        await set({ blockThirdPartyCookies: enabled })
        const run = `${incognito}-${enabled}`
        await navigate(`${origin}/embed?run=${run}`)
        await waitFor(
          () => site.executeJavaScript('window.cookieResult !== null'),
          'Cross-site frame must report cookie access'
        )
        const result = await site.executeJavaScript('window.cookieResult')
        const request = requests.find(
          (entry) => entry.url.pathname === '/third' && entry.url.searchParams.get('run') === run
        )
        assert.equal(
          request.cookie.includes('unpartitioned='),
          !enabled,
          `Third-party Cookie header, ${run}`
        )
        assert.equal(
          result.cookie.includes('thirdJs='),
          !enabled,
          `JavaScript cookie access, ${run}`
        )
        assert.equal(
          result.cookie.includes('partitioned='),
          true,
          `Partitioned cookies must work, ${run}`
        )
      }
      console.log(
        `PASS: ${incognito ? 'private' : 'normal'} tracking redirects, consent rejection, live settings, third-party cookies ${cookieBlocked ? 'blocked' : 'allowed'}, CHIPS`
      )
    }
    await set({ autoRejectConsent: true, cleanTrackingLinks: true, blockThirdPartyCookies: true })
    console.log(
      'PASS: clean-link edge cases, defaults, validation, accessible settings, narrow layout'
    )
    window.close()
    store.close()
    server.close()
    app.exit(0)
  } catch (error) {
    console.error('FAIL:', error.stack)
    if (!window.isDestroyed()) window.close()
    store.close()
    server.close()
    app.exit(1)
  }
})
