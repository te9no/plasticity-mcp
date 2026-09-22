const stateKey = 'plasticity-mcp.main-inspector.v1';

function idLiteral(webContentsId: number): string {
  if (!Number.isSafeInteger(webContentsId) || webContentsId <= 0) {
    throw new TypeError('webContentsId must be a positive safe integer');
  }
  return String(webContentsId);
}

function stringLiteral(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  if (value.length > 512) throw new TypeError(`${name} is too long`);
  return JSON.stringify(value);
}

function jsonLiteral(value: unknown, name: string): string {
  const seen = new WeakSet<object>();
  const visit = (current: unknown, path: string): void => {
    // Match JSON.stringify for optional values used by CDP: object properties are
    // omitted and array entries become null. JSON.stringify performs that final
    // normalization after this validator returns.
    if (current === undefined) return;
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError(`${path} must be a finite number`);
      return;
    }
    if (typeof current !== 'object') throw new TypeError(`${path} is not JSON serializable`);
    if (seen.has(current)) throw new TypeError(`${path} contains a circular reference`);
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain object`);
      for (const [key, item] of Object.entries(current)) visit(item, `${path}.${key}`);
    }
    seen.delete(current);
  };
  visit(value, name);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError(`${name} is not JSON serializable`);
  return serialized;
}

const electronExpression = `(() => {
  const mainModule = process.mainModule;
  if (!mainModule || typeof mainModule.require !== 'function') throw new Error('Plasticity main module require is unavailable');
  const electron = mainModule.require('electron');
  if (!electron?.BrowserWindow || !electron?.webContents) throw new Error('Electron main-process APIs are unavailable');
  return electron;
})()`;

export function buildMainDiscoveryExpression(): string {
  return `(() => {
    const electron = ${electronExpression};
    return electron.BrowserWindow.getAllWindows().map(window => {
      const contents = window.webContents;
      return {id: contents.id, url: contents.getURL(), title: contents.getTitle()};
    });
  })()`;
}

export function buildAttachExpression(webContentsId: number, sessionId: string): string {
  const id = idLiteral(webContentsId);
  const session = stringLiteral(sessionId, 'sessionId');
  return `(() => {
    const electron = ${electronExpression};
    const key = Symbol.for(${JSON.stringify(stateKey)});
    const state = globalThis[key] ??= {version: 1, entries: new Map()};
    if (state.version !== 1 || !(state.entries instanceof Map)) throw new Error('Plasticity inspector bridge state is incompatible');
    const id = ${id}, session = ${session};
    const contents = electron.webContents.fromId(id);
    if (!contents || contents.isDestroyed()) throw new Error('Plasticity webContents not found: ' + id);
    const existing = state.entries.get(id);
    if (existing) {
      if (existing.contents !== contents || !existing.debugger.isAttached()) throw new Error('Plasticity debugger ownership was lost for webContents ' + id);
      existing.sessions.add(session);
      return {id, attached: true, reused: true, sessions: existing.sessions.size};
    }
    const debug = contents.debugger;
    if (debug.isAttached()) throw new Error('Plasticity webContents debugger is already attached by another client: ' + id);
    debug.attach('1.3');
    const entry = {contents, debugger: debug, sessions: new Set([session]), onDetach: undefined, onDestroyed: undefined};
    const cleanup = () => {
      if (state.entries.get(id) !== entry) return;
      state.entries.delete(id);
      debug.removeListener?.('detach', entry.onDetach);
      contents.removeListener?.('destroyed', entry.onDestroyed);
    };
    entry.onDetach = cleanup;
    entry.onDestroyed = cleanup;
    state.entries.set(id, entry);
    debug.on?.('detach', entry.onDetach);
    contents.on?.('destroyed', entry.onDestroyed);
    return {id, attached: true, reused: false, sessions: 1};
  })()`;
}

export function buildDetachExpression(webContentsId: number, sessionId: string): string {
  const id = idLiteral(webContentsId);
  const session = stringLiteral(sessionId, 'sessionId');
  return `(() => {
    const key = Symbol.for(${JSON.stringify(stateKey)}), state = globalThis[key];
    const id = ${id}, session = ${session};
    const entry = state?.version === 1 && state.entries instanceof Map ? state.entries.get(id) : undefined;
    if (!entry || !entry.sessions.has(session)) throw new Error('Plasticity inspector session is not attached: ' + session);
    entry.sessions.delete(session);
    if (entry.sessions.size) return {id, detached: false, sessions: entry.sessions.size};
    if (!entry.contents.isDestroyed() && entry.debugger.isAttached()) {
      entry.debugger.removeListener?.('detach', entry.onDetach);
      entry.contents.removeListener?.('destroyed', entry.onDestroyed);
      try {
        entry.debugger.detach();
      } catch (error) {
        if (!entry.contents.isDestroyed() && entry.debugger.isAttached()) {
          entry.sessions.add(session);
          entry.debugger.on?.('detach', entry.onDetach);
          entry.contents.on?.('destroyed', entry.onDestroyed);
        } else {
          state.entries.delete(id);
        }
        throw error;
      }
      state.entries.delete(id);
      return {id, detached: true, sessions: 0};
    }
    entry.debugger.removeListener?.('detach', entry.onDetach);
    entry.contents.removeListener?.('destroyed', entry.onDestroyed);
    state.entries.delete(id);
    return {id, detached: false, sessions: 0};
  })()`;
}

export function buildScreenshotExpression(webContentsId: number, sessionId: string): string {
  const id = idLiteral(webContentsId);
  const session = stringLiteral(sessionId, 'sessionId');
  return `(async () => {
    const key = Symbol.for(${JSON.stringify(stateKey)}), state = globalThis[key];
    const id = ${id}, session = ${session};
    const entry = state?.version === 1 && state.entries instanceof Map ? state.entries.get(id) : undefined;
    if (!entry || !entry.sessions.has(session)) throw new Error('Plasticity inspector session is not attached: ' + session);
    if (entry.contents.isDestroyed()) throw new Error('Plasticity webContents was destroyed: ' + id);
    if (!entry.debugger.isAttached()) throw new Error('Plasticity renderer debugger detached unexpectedly: ' + id);
    const image = await entry.contents.capturePage();
    return {data: image.toPNG().toString('base64')};
  })()`;
}

export function buildRendererCommandExpression(
  webContentsId: number,
  sessionId: string,
  method: string,
  params: Record<string, unknown> = {},
): string {
  const id = idLiteral(webContentsId);
  const session = stringLiteral(sessionId, 'sessionId');
  const command = stringLiteral(method, 'method');
  const commandParams = jsonLiteral(params, 'params');
  return `(async () => {
    const key = Symbol.for(${JSON.stringify(stateKey)}), state = globalThis[key];
    const id = ${id}, session = ${session};
    const entry = state?.version === 1 && state.entries instanceof Map ? state.entries.get(id) : undefined;
    if (!entry || !entry.sessions.has(session)) throw new Error('Plasticity inspector session is not attached: ' + session);
    if (entry.contents.isDestroyed()) throw new Error('Plasticity webContents was destroyed: ' + id);
    if (!entry.debugger.isAttached()) throw new Error('Plasticity renderer debugger detached unexpectedly: ' + id);
    return await entry.debugger.sendCommand(${command}, ${commandParams});
  })()`;
}
