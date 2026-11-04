export function commandSandboxBootstrap(source: string): string {
  const worker = `
    const defineCommand = definition => definition;
    const pending = new Map();
    let sequence = 0;
    const call = (permission, argument) => new Promise((resolve, reject) => {
      const requestId = ++sequence;
      pending.set(requestId, { resolve, reject });
      self.postMessage({ type: 'call', requestId, permission, argument });
    });
    (() => { ${source}\n })();
    const command = globalThis.__reiCommand;
    if (!command || typeof command.run !== 'function') throw new Error('Export defineCommand with a run function.');
    self.postMessage({ type: 'metadata', metadata: {
      name: command.name, command: command.command, description: command.description,
      version: command.version, intent: command.intent
    } });
    self.addEventListener('message', async event => {
      const message = event.data;
      if (message.type === 'reply') {
        const request = pending.get(message.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.result);
      } else if (message.type === 'run') {
        try {
          await command.run(Object.freeze({
            activeTab: Object.freeze({ media: Object.freeze({ current: () => call('activeTab.media') }) }),
            downloads: Object.freeze({ enqueue: media => call('downloads.enqueue', media) })
          }));
          self.postMessage({ type: 'done' });
        } catch (failure) {
          self.postMessage({ type: 'done', error: String(failure?.message || failure).slice(0, 1000) });
        }
      }
    });
  `
  return `new Promise((resolve, reject) => {
    const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}], { type: 'text/javascript' })));
    let completion;
    let running = false;
    let calls = 0;
    const errorMessage = failure => String(failure?.message || failure).slice(0, 1000);
    worker.onerror = event => {
      event.preventDefault();
      const error = errorMessage(event.message);
      if (completion) completion({ error });
      else reject(new Error(error));
    };
    globalThis.__reiRunCommand = () => new Promise(finish => {
      completion = finish;
      running = true;
      worker.postMessage({ type: 'run' });
    });
    worker.onmessage = async event => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'metadata' && !globalThis.__reiCommandMetadata) {
        try {
          const metadata = message.metadata;
          if (!metadata || typeof metadata !== 'object') throw new Error('Invalid command metadata.');
          for (const [key, limit] of [['name', 80], ['command', 32], ['description', 300], ['version', 40]]) {
            if (key === 'version' && metadata[key] === undefined) continue;
            if (typeof metadata[key] !== 'string' || metadata[key].length > limit) throw new Error('Invalid command ' + key + '.');
          }
          if (!metadata.intent || typeof metadata.intent !== 'object' || Array.isArray(metadata.intent)) throw new Error('Declare requested access in intent.');
          const intent = Object.entries(metadata.intent);
          if (intent.length > 2 || intent.some(([key, reason]) => key.length > 64 || typeof reason !== 'string' || reason.length > 300)) throw new Error('Invalid command intent.');
          globalThis.__reiCommandMetadata = {
            name: metadata.name, command: metadata.command, description: metadata.description,
            version: metadata.version, intent: Object.fromEntries(intent)
          };
          resolve();
        } catch (failure) { reject(new Error(errorMessage(failure))); }
      } else if (message.type === 'call') {
        try {
          if (!running) throw new Error('Browser access is unavailable during metadata inspection.');
          if (++calls > 64) throw new Error('Command exceeded its 64-call limit.');
          const result = await globalThis.reiCommandHost.call(message.permission, message.argument);
          worker.postMessage({ type: 'reply', requestId: message.requestId, result });
        } catch (failure) {
          worker.postMessage({ type: 'reply', requestId: message.requestId, error: errorMessage(failure) });
        }
      } else if (message.type === 'done' && running) {
        running = false;
        completion({ error: typeof message.error === 'string' ? message.error.slice(0, 1000) : undefined });
      }
    };
  })`
}
