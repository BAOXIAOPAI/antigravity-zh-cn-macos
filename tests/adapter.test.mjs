import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readDebugPort, isAppTarget, localSocketUrl, buildTranslationScript, compileTranslationScript, applyTranslation, CDP } from '../adapter.mjs';

test('accepts the installed app port format and rejects malformed ports', () => {
  assert.equal(readDebugPort('50365\n/devtools/browser/abc-123\n'), 50365);
  for (const value of ['0\n/devtools/browser/id', '65536\n/devtools/browser/id', 'abc\n/devtools/browser/id', '80\nhttps://example.com']) {
    assert.throws(() => readDebugPort(value));
  }
});

test('only selects the local Antigravity main page', () => {
  const app = { type: 'page', title: 'Antigravity', url: 'https://127.0.0.1:50373/?settingsOpen=true' };
  assert.equal(isAppTarget(app), true);
  assert.equal(isAppTarget({ ...app, title: '你好 - keen-bardeen - Antigravity', url: 'https://127.0.0.1:50373/c/123' }), true);
  for (const change of [
    { type: 'webview' }, { type: 'iframe' }, { title: 'Google Chrome' }, { title: undefined },
    { title: '你好 - Antigravity Fake' }, { title: 'Antigravity - Another App' },
    { url: 'https://example.com' }, { url: 'https://127.0.0.1.evil.example:50373/' },
    { url: 'https://user:pass@127.0.0.1:50373/' }, { url: 'file:///tmp/index.html' }
  ]) assert.equal(isAppTarget({ ...app, ...change }), false);
});

test('never connects to a remote or unrelated debugging socket', () => {
  assert.equal(localSocketUrl('ws://127.0.0.1:12345/devtools/page/abc-123', 12345), 'ws://127.0.0.1:12345/devtools/page/abc-123');
  for (const url of [
    'ws://example.com:12345/devtools/page/id', 'ws://127.0.0.1:9999/devtools/page/id',
    'ws://127.0.0.1:12345/devtools/browser/id', 'wss://127.0.0.1:12345/devtools/page/id',
    'ws://127.0.0.1:12345/devtools/page/id?token=test'
  ]) assert.throws(() => localSocketUrl(url, 12345));
});

test('does not inject until native app identity is confirmed', async () => {
  const calls = [];
  const client = { evaluate: async code => { calls.push(code); return false; } };
  assert.equal(await applyTranslation(client, 'TRANSLATE'), null);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /electronNative/);
  assert.match(calls[0], /endsWith\(' - Antigravity'\)/);
  assert.equal(calls.includes('TRANSLATE'), false);
});

test('applies and restores through the verified app only', async () => {
  const calls = [];
  const client = { evaluate: async code => { calls.push(code); return calls.length % 2 ? true : { ok: true }; } };
  await applyTranslation(client, 'TRANSLATE');
  await applyTranslation(client, 'TRANSLATE', true);
  assert.equal(calls[1], 'TRANSLATE');
  assert.match(calls[3], /__antigravityZhCN\?\.stop/);
});

test('built translator has no placeholder and parses as JavaScript', () => {
  const script = buildTranslationScript();
  assert.doesNotMatch(script, /__AG_ZH_DICTIONARY__|__AG_ZH_REVISION__/);
  assert.doesNotThrow(() => new Function(script));
  assert.doesNotMatch(script, /\bfetch\s*\(|XMLHttpRequest|localStorage|\.innerHTML\s*=/);
});

test('source or dictionary changes create a new revision for automatic replacement', () => {
  const source = 'const revision="__AG_ZH_REVISION__"; const dictionary=__AG_ZH_DICTIONARY__;';
  const first = compileTranslationScript(source, { Model: '模型' });
  assert.equal(first, compileTranslationScript(source, { Model: '模型' }));
  assert.notEqual(first.match(/revision="(.*?)"/)[1], compileTranslationScript(source, { Model: '新模型' }).match(/revision="(.*?)"/)[1]);
  assert.notEqual(first.match(/revision="(.*?)"/)[1], compileTranslationScript(source + '\n// updated observer', { Model: '模型' }).match(/revision="(.*?)"/)[1]);
});

class FakeSocket extends EventEmitter {
  addEventListener(name, callback) { this.on(name, callback); }
  send(data) { this.sent = JSON.parse(data); }
  close() { this.emit('close'); }
}

test('CDP matches reply IDs, ignores events, propagates errors and closes pending calls', async () => {
  const socket = new FakeSocket();
  const client = new CDP(socket);
  const first = client.evaluate('1+1');
  socket.emit('message', { data: JSON.stringify({ method: 'Page.frameNavigated', params: {} }) });
  socket.emit('message', { data: JSON.stringify({ id: socket.sent.id, result: { result: { value: 2 } } }) });
  assert.equal(await first, 2);
  const second = client.call('Runtime.evaluate');
  socket.emit('message', { data: JSON.stringify({ id: socket.sent.id, error: { message: 'unsupported' } }) });
  await assert.rejects(second, /unsupported/);
  const third = client.call('Runtime.evaluate');
  client.close();
  await assert.rejects(third, /断开/);
});
