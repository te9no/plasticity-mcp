import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createContext, runInContext} from 'node:vm';
import {
  buildAttachExpression,
  buildDetachExpression,
  buildMainDiscoveryExpression,
  buildRendererCommandExpression,
  buildScreenshotExpression,
} from './main-inspector.js';

interface FakeDebugger {
  attached: boolean;
  attachCalls: string[];
  detachCalls: number;
  commands: Array<{method: string; params: unknown}>;
  isAttached(): boolean;
  attach(version: string): void;
  detach(): void;
  sendCommand(method: string, params: unknown): Promise<unknown>;
  on: EventEmitter['on'];
  removeListener: EventEmitter['removeListener'];
  emit: EventEmitter['emit'];
  listenerCount: EventEmitter['listenerCount'];
}

function fakeContents(id: number, url: string, title: string, initiallyAttached = false) {
  let captureCalls = 0;
  let destroyed = false;
  const debugEvents = new EventEmitter();
  const contentsEvents = new EventEmitter();
  const debug: FakeDebugger = {
    attached: initiallyAttached,
    attachCalls: [],
    detachCalls: 0,
    commands: [],
    isAttached() { return this.attached; },
    attach(version) { this.attached = true; this.attachCalls.push(version); },
    detach() { this.attached = false; this.detachCalls++; },
    async sendCommand(method, params) { this.commands.push({method, params}); return {method, params}; },
    on: debugEvents.on.bind(debugEvents),
    removeListener: debugEvents.removeListener.bind(debugEvents),
    emit: debugEvents.emit.bind(debugEvents),
    listenerCount: debugEvents.listenerCount.bind(debugEvents),
  };
  return {
    id,
    debug,
    get captureCalls() { return captureCalls; },
    isDestroyed: () => destroyed,
    getURL: () => url,
    getTitle: () => title,
    debugger: debug,
    on: contentsEvents.on.bind(contentsEvents),
    removeListener: contentsEvents.removeListener.bind(contentsEvents),
    listenerCount: contentsEvents.listenerCount.bind(contentsEvents),
    destroy() { destroyed = true; contentsEvents.emit('destroyed'); },
    async capturePage() {
      captureCalls++;
      return {toPNG: () => Buffer.from('fake-png')};
    },
  };
}

function harness() {
  const first = fakeContents(7, 'file:///Plasticity/app/.webpack/renderer/app_window/index.html', 'Model A');
  const external = fakeContents(8, 'file:///Plasticity/app/.webpack/renderer/app_window/index.html', 'Model B', true);
  const rows = new Map([[first.id, first], [external.id, external]]);
  const electron = {
    BrowserWindow: {getAllWindows: () => [...rows.values()].map(webContents => ({webContents}))},
    webContents: {fromId: (id: number) => rows.get(id)},
  };
  const context = createContext({
    process: {mainModule: {require: (name: string) => {
      if (name !== 'electron') throw new Error(`Unexpected module: ${name}`);
      return electron;
    }}},
  });
  const evaluate = <T>(expression: string): T => runInContext(expression, context) as T;
  return {first, external, evaluate};
}

test('main discovery returns renderer identity without attaching a debugger', () => {
  const {first, external, evaluate} = harness();
  assert.deepEqual(
    structuredClone(evaluate(buildMainDiscoveryExpression())),
    [
      {id: 7, url: first.getURL(), title: first.getTitle()},
      {id: 8, url: external.getURL(), title: external.getTitle()},
    ],
  );
  assert.equal(first.debug.attachCalls.length, 0);
});

test('bridge shares an owned attachment and only the last session detaches', async () => {
  const {first, evaluate} = harness();
  assert.deepEqual(structuredClone(evaluate(buildAttachExpression(7, 'client-a'))), {id: 7, attached: true, reused: false, sessions: 1});
  assert.deepEqual(structuredClone(evaluate(buildAttachExpression(7, 'client-b'))), {id: 7, attached: true, reused: true, sessions: 2});
  assert.deepEqual(first.debug.attachCalls, ['1.3']);

  const params = {
    expression: '"</script>"; globalThis.pwned = true',
    nested: {quote: '\u2028', optional: undefined},
    values: [1, true, null, undefined],
    optional: undefined,
  };
  const normalizedParams = {
    expression: params.expression,
    nested: {quote: params.nested.quote},
    values: [1, true, null, null],
  };
  const response = await evaluate<Promise<unknown>>(buildRendererCommandExpression(7, 'client-b', 'Runtime.evaluate', params));
  assert.deepEqual(structuredClone(response), {method: 'Runtime.evaluate', params: normalizedParams});
  assert.deepEqual(structuredClone(first.debug.commands), [{method: 'Runtime.evaluate', params: normalizedParams}]);

  assert.deepEqual(
    structuredClone(await evaluate<Promise<unknown>>(buildScreenshotExpression(7, 'client-a'))),
    {data: Buffer.from('fake-png').toString('base64')},
  );
  assert.equal(first.captureCalls, 1);

  assert.deepEqual(structuredClone(evaluate(buildDetachExpression(7, 'client-a'))), {id: 7, detached: false, sessions: 1});
  assert.equal(first.debug.detachCalls, 0);
  assert.deepEqual(structuredClone(evaluate(buildDetachExpression(7, 'client-b'))), {id: 7, detached: true, sessions: 0});
  assert.equal(first.debug.detachCalls, 1);
  assert.equal(first.debug.listenerCount('detach'), 0);
  assert.equal(first.listenerCount('destroyed'), 0);
});

test('external detach clears stale ownership without allowing the old session to detach a new owner', async () => {
  const {first, evaluate} = harness();
  evaluate(buildAttachExpression(7, 'old-client'));
  first.debug.attached = false;
  first.debug.emit('detach', {}, 'target closed');
  assert.equal(first.debug.listenerCount('detach'), 0);
  assert.equal(first.listenerCount('destroyed'), 0);

  assert.deepEqual(
    structuredClone(evaluate(buildAttachExpression(7, 'new-client'))),
    {id: 7, attached: true, reused: false, sessions: 1},
  );
  assert.throws(() => evaluate(buildDetachExpression(7, 'old-client')), /not attached/);
  assert.equal(first.debug.isAttached(), true);
  await assert.doesNotReject(
    evaluate<Promise<unknown>>(buildRendererCommandExpression(7, 'new-client', 'Runtime.evaluate', {})),
  );
  evaluate(buildDetachExpression(7, 'new-client'));
});

test('destroyed webContents clears bridge ownership and listeners', () => {
  const {first, evaluate} = harness();
  evaluate(buildAttachExpression(7, 'client'));
  assert.equal(first.debug.listenerCount('detach'), 1);
  assert.equal(first.listenerCount('destroyed'), 1);
  first.destroy();
  assert.equal(first.debug.listenerCount('detach'), 0);
  assert.equal(first.listenerCount('destroyed'), 0);
  assert.throws(() => evaluate(buildDetachExpression(7, 'client')), /not attached/);
});

test('bridge rejects external ownership and unknown sessions', async () => {
  const {evaluate} = harness();
  assert.throws(() => evaluate(buildAttachExpression(8, 'ours')), /another client/);
  assert.throws(() => evaluate(buildDetachExpression(7, 'missing')), /not attached/);
  await assert.rejects(
    evaluate<Promise<unknown>>(buildRendererCommandExpression(7, 'missing', 'Runtime.evaluate', {})),
    /not attached/,
  );
  await assert.rejects(evaluate<Promise<unknown>>(buildScreenshotExpression(7, 'missing')), /not attached/);
});

test('failed debugger detach retains ownership for a later cleanup attempt', () => {
  const {first, evaluate} = harness();
  evaluate(buildAttachExpression(7, 'client'));
  const detach = first.debug.detach;
  first.debug.detach = () => { throw new Error('detach failed'); };
  assert.throws(() => evaluate(buildDetachExpression(7, 'client')), /detach failed/);
  first.debug.detach = detach;
  assert.deepEqual(
    structuredClone(evaluate(buildDetachExpression(7, 'client'))),
    {id: 7, detached: true, sessions: 0},
  );
});

test('expression builders reject invalid identifiers and non-JSON command parameters', () => {
  assert.throws(() => buildAttachExpression(0, 'client'), /positive safe integer/);
  assert.throws(() => buildAttachExpression(1.5, 'client'), /positive safe integer/);
  assert.throws(() => buildAttachExpression(1, ''), /non-empty string/);
  assert.throws(() => buildRendererCommandExpression(1, 'client', '', {}), /non-empty string/);
  assert.throws(() => buildScreenshotExpression(-1, 'client'), /positive safe integer/);
  assert.throws(() => buildRendererCommandExpression(1, 'client', 'Runtime.evaluate', {value: Number.NaN}), /finite number/);
  assert.doesNotThrow(() => buildRendererCommandExpression(1, 'client', 'Runtime.evaluate', {value: undefined}));
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => buildRendererCommandExpression(1, 'client', 'Runtime.evaluate', circular), /circular reference/);
});
