import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extensionOriginCovered } from './src/shared/extension-permissions'
import { createExtensionProxyBridge } from './src/preload/extension-proxy'
import { createExtensionCompatibilityBridge } from './src/preload/extension-compatibility'

const require = createRequire(import.meta.url)

export default defineConfig({
  main: {
    plugins: [
      {
        name: 'extension-background-compatibility',
        generateBundle() {
          let source = readFileSync(require.resolve('electron-chrome-extensions/preload'), 'utf8')
          const replace = (needle: string, replacement: string): void => {
            if (source.split(needle).length !== 2)
              throw new Error('Extension preload changed. Recheck extension API compatibility.')
            source = source.replace(needle, () => replacement)
          }
          replace('managed: local,', 'managed: compatibility.managed,')
          replace(
            '        set() {\n        }\n        get() {\n        }\n        clear() {\n        }',
            `        set(...args) { return compatibility.unsupported(...args); }
        get(...args) { return compatibility.unsupported(...args); }
        clear(...args) { return compatibility.unsupported(...args); }`
          )
          replace(
            '              openOptionsPage: invokeExtension2("runtime.openOptionsPage"),',
            `              sendMessage: compatibility.sendMessage,
              openOptionsPage: invokeExtension2("runtime.openOptionsPage"),`
          )
          replace('Object.freeze(chrome);', 'globalThis.browser = chrome;')
          replace(
            '      delete globalThis.electron;',
            `      Object.defineProperty(chrome.runtime, 'lastError', {configurable:true, get:() => compatibility.getLastError() ?? (proxyBridge ? proxyBridge.getLastError() : nativeRuntime.lastError)});
      delete globalThis.electron;`
          )
          replace(
            'import_electron.ipcRenderer.send("crx-add-listener", extensionId, name);',
            `import_electron.ipcRenderer.send(name.startsWith('rei.proxy.') ? 'rei-extension-proxy-subscribe' : 'crx-add-listener', extensionId, name);`
          )
          replace(
            'result = await import_electron2.ipcRenderer.invoke("crx-msg", extensionId, fnName, ...args);',
            `result = await import_electron2.ipcRenderer.invoke(fnName.startsWith('rei.proxy.') ? 'rei-extension-proxy' : 'crx-msg', extensionId, fnName, ...args);`
          )
          replace(
            'console.log(fnName, args);',
            `if (!fnName.startsWith('rei.proxy.')) console.log(fnName, args);`
          )
          replace(
            'console.log(fnName, "(result)", result);',
            `if (!fnName.startsWith('rei.proxy.')) console.log(fnName, "(result)", result);`
          )
          replace(
            '      const apiDefinitions = {',
            `      const nativeRuntime = chrome.runtime;
      const compatibility = (${createExtensionCompatibilityBridge.toString()})(nativeRuntime);
      const proxyBridge = manifest.permissions?.some(permission => permission === 'proxy' || permission === 'privacy') ? (${createExtensionProxyBridge.toString()})(
        (method, details) => invokeExtension2(method)(details),
        (name, listener) => new ExtensionEvent(name).addListener(listener),
        chrome.runtime
      ) : undefined;
      const apiDefinitions = {`
          )
          replace(
            '        privacy: {',
            `        proxy: {
          shouldInject: () => !!manifest.permissions?.includes('proxy'),
          factory: base => ({...base, settings: proxyBridge.patchSetting(base?.settings, proxyBridge.settings)})
        },
        privacy: {`
          )
          replace(
            'webRTCIPHandlingPolicy: new ChromeSetting()',
            'webRTCIPHandlingPolicy: proxyBridge ? proxyBridge.patchSetting(base?.network?.webRTCIPHandlingPolicy, proxyBridge.webRTC) : new ChromeSetting()'
          )
          replace(
            'onHeadersReceived: new ExtensionEvent("webRequest.onHeadersReceived")',
            `onHeadersReceived: new ExtensionEvent("webRequest.onHeadersReceived"),
              onAuthRequired: proxyBridge && manifest.permissions?.includes('webRequestAuthProvider')
                ? Object.assign(base?.onAuthRequired || {}, proxyBridge.auth)
                : base?.onAuthRequired`
          )
          replace(
            'console.error(`injectExtensionAPIs error (${location.href})`);',
            "console.error('injectExtensionAPIs error');"
          )
          replace(
            'contains: invokeExtension2("permissions.contains"),',
            `contains: (permissions, callback) => {
                  const originCovered = ${extensionOriginCovered.toString()};
                  const result = invokeExtension2('permissions.getAll')().then(current => {
                    const granted = current?.permissions || [];
                    const origins = [...(current?.origins || []), ...granted];
                    return (permissions.permissions || []).every(permission => granted.includes(permission)) &&
                      (permissions.origins || []).every(origin => origins.some(grant => originCovered(grant, origin)));
                  });
                  if (callback) result.then(callback);
                  return result;
                },`
          )
          replace(
            '    injectExtensionAPIs();',
            `    const initializeExtensionAPIs = () => {
      if (process.type !== 'service-worker' && !process.contextIsolated && location.hostname === 'fkgkibajhfbepljeaefdnfnegdcjomkh' && location.pathname === '/background.html') {
        chrome.storage.local.remove('cachedManagedStorage').catch(console.error);
      }
      injectExtensionAPIs();
    };
    if (process.type !== 'service-worker' && document.readyState === 'loading') {
      document.addEventListener('readystatechange', initializeExtensionAPIs, { once: true });
    } else {
      initializeExtensionAPIs();
    }`
          )
          this.emitFile({ type: 'asset', fileName: 'extension-api.preload.cjs', source })
        }
      }
    ]
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          keyboard: resolve(__dirname, 'src/preload/keyboard.ts'),
          command: resolve(__dirname, 'src/preload/command.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [svelte()]
  }
})
