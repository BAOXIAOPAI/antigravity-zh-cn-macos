#!/usr/bin/env node
// Connects only to the debugging endpoint Antigravity already enables itself.
// No application files, signatures, approval settings, or network flags change.
import { readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID, createHash } from 'node:crypto';

export const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT_FILE = join(homedir(), 'Library/Application Support/Antigravity/DevToolsActivePort');
const STATE_FILE = join(ROOT, '.watch-state.json');
const IDENTITY = `location.hostname === '127.0.0.1' &&
  (document.title === 'Antigravity' || document.title.endsWith(' - Antigravity')) &&
  typeof window.electronNative?.getZoomLevel === 'function' &&
  typeof window.nativeStorage?.getItems === 'function'`;

export function buildTranslationScript() {
  const dictionary = JSON.parse(readFileSync(join(ROOT, 'zh-CN.json'), 'utf8'));
  const source = readFileSync(join(ROOT, 'translator.js'), 'utf8');
  return compileTranslationScript(source, dictionary);
}

export function compileTranslationScript(source, dictionary) {
  const encoded = JSON.stringify(dictionary);
  const revision = createHash('sha256').update(source).update(encoded).digest('hex').slice(0, 16);
  return source.replace('__AG_ZH_DICTIONARY__', () => encoded).replace('__AG_ZH_REVISION__', revision);
}

export function readDebugPort(content) {
  const lines = content.trim().split(/\r?\n/);
  if (!/^\d{1,5}$/.test(lines[0]) || Number(lines[0]) < 1 || Number(lines[0]) > 65535 ||
      !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(lines[1] || '')) {
    throw new Error('Antigravity 调试端口文件格式不正确。');
  }
  return Number(lines[0]);
}

export function isAppTarget(target) {
  try {
    const url = new URL(target.url);
    return target.type === 'page' && typeof target.title === 'string' &&
      (target.title === 'Antigravity' || target.title.endsWith(' - Antigravity')) &&
      ['http:', 'https:'].includes(url.protocol) && url.hostname === '127.0.0.1' &&
      Boolean(url.port) && !url.username && !url.password;
  } catch { return false; }
}

export function localSocketUrl(value, port) {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.port !== String(port) ||
      !/^\/devtools\/page\/[a-zA-Z0-9-]+$/.test(url.pathname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('拒绝连接非 Antigravity 本机调试地址。');
  }
  return url.href;
}

export class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => this.failPending());
    socket.addEventListener('error', () => this.failPending());
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('本机调试连接超时。')); }, 3500);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接 Antigravity。')); }, { once: true });
    });
    return new CDP(socket);
  }

  failPending() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Antigravity 调试连接已断开。'));
    }
    this.pending.clear();
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('界面响应超时。')); }, 4000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', { expression, returnByValue: true });
    if (response.exceptionDetails) throw new Error('中文适配脚本执行失败。');
    return response.result?.value;
  }

  close() { this.failPending(); this.socket.close(); }
}

export async function applyTranslation(client, script, restore = false) {
  // Checking native preload functions excludes websites and embedded webviews.
  if (!(await client.evaluate(IDENTITY))) return null;
  return client.evaluate(restore
    ? 'window.__antigravityZhCN?.stop() || ({restored: true})'
    : script);
}

async function discover() {
  const port = readDebugPort(readFileSync(PORT_FILE, 'utf8'));
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(3500), redirect: 'error'
  });
  if (!response.ok) throw new Error('无法读取 Antigravity 本机窗口列表。');
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error('窗口列表格式不正确。');
  return targets.filter(isAppTarget).map(target => ({
    id: target.id, socketUrl: localSocketUrl(target.webSocketDebuggerUrl, port)
  }));
}

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

function acquireWatch() {
  const previous = readState();
  if (previous?.pid) {
    let alive = true;
    try { process.kill(previous.pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
    if (alive) throw new Error('中文适配器已在运行。请保留原来的终端窗口，或先双击“恢复英文”。');
    unlinkSync(STATE_FILE);
  }
  const state = { pid: process.pid, token: randomUUID(), stop: false };
  const file = openSync(STATE_FILE, 'wx', 0o600);
  try { writeFileSync(file, JSON.stringify(state)); } finally { closeSync(file); }
  return state;
}

async function stopExistingWatch() {
  const previous = readState();
  if (!previous?.pid) return;
  try { process.kill(previous.pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return; throw error; }
  writeFileSync(STATE_FILE, JSON.stringify({ ...previous, stop: true }), { mode: 0o600 });
  console.log('正在让旧版适配器恢复界面并退出…');
  for (let attempt = 0; attempt < 80; attempt++) {
    if (readState()?.token !== previous.token) return;
    await delay(125);
  }
  throw new Error('旧版适配器尚未退出。请在原终端按 Control+C，再运行本启动器。');
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--restore', '--once', '--restart', '--help'].includes(arg))) throw new Error('未知参数。支持 --restore、--once、--restart、--help。');
  if (args.includes('--help')) {
    console.log('node adapter.mjs           保持中文适配，词典和代码更新会自动重载\nnode adapter.mjs --restart 平滑替换正在运行的旧版适配器\nnode adapter.mjs --once    仅适配当前窗口一次\nnode adapter.mjs --restore 恢复英文并停止正在运行的适配器');
    return;
  }
  if (typeof WebSocket !== 'function') throw new Error('需要 Node.js 22 或更新版本。请使用本文件夹内的启动器。');
  const restore = args.includes('--restore');
  const once = restore || args.includes('--once');
  if (args.includes('--restart') && once) throw new Error('--restart 不能与 --restore 或 --once 同时使用。');
  if (args.includes('--restart')) await stopExistingWatch();
  let script = restore ? '' : buildTranslationScript();
  const watch = once ? null : acquireWatch();
  const clients = new Map();
  let stopping = false;
  let confirmed = false;
  let lastMessage = '';
  const started = Date.now();
  const say = message => { if (message !== lastMessage) { console.log(message); lastMessage = message; } };
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (restore) {
    const state = readState();
    if (state) writeFileSync(STATE_FILE, JSON.stringify({ ...state, stop: true }), { mode: 0o600 });
  }
  try {
    if (!once) say('正在等待 Antigravity 主窗口。可先正常打开 Antigravity。');
    do {
      if (watch) {
        const state = readState();
        if (!state || state.token !== watch.token || state.stop) break;
      }
      try {
        if (watch) {
          try { script = buildTranslationScript(); }
          catch { say('翻译文件暂时无法读取，继续使用上一次有效版本；保存完成后将自动重试。'); }
        }
        const targets = await discover();
        const active = new Set(targets.map(target => target.socketUrl));
        for (const [url, client] of clients) {
          if (!active.has(url)) { client.close(); clients.delete(url); }
        }
        let matched = 0;
        let translated = 0;
        for (const target of targets) {
          let client = clients.get(target.socketUrl);
          try {
            if (!client) {
              client = await CDP.connect(target.socketUrl);
              clients.set(target.socketUrl, client);
            }
            const status = await applyTranslation(client, script, restore);
            if (status) { matched++; translated += status.textNodes || 0; }
          } catch (error) {
            client?.close(); clients.delete(target.socketUrl);
            if (once) throw error;
          }
        }
        if (matched) {
          confirmed = true;
          say(restore ? '已恢复英文。' : `已适配 ${matched} 个窗口，当前翻译 ${translated} 处界面文字。\n保留此终端窗口；按 Ctrl+C 可恢复英文并退出。`);
        } else {
          say('未找到可确认身份的 Antigravity 原生主窗口，请正常打开应用。');
        }
      } catch (error) {
        if (once) throw new Error(`连接失败：${error.code === 'ENOENT' ? '请先打开 Antigravity。' : error.message}`);
        say('等待 Antigravity 就绪；适配器不会修改应用或开启额外调试端口。');
      }
      if (!once && !confirmed && Date.now() - started > 30000) {
        throw new Error('30 秒内未连接成功。请确认 Antigravity 已打开；本版本可能不兼容。');
      }
      if (!once && !stopping) await delay(1500);
    } while (!once && !stopping);
    if (once && !confirmed) throw new Error('没有找到可适配的 Antigravity 主窗口。');
  } finally {
    if (watch) {
      for (const client of clients.values()) {
        try { await applyTranslation(client, script, true); } catch { /* App may have quit. */ }
      }
      if (readState()?.token === watch.token) unlinkSync(STATE_FILE);
      console.log('中文适配已停止；已连接的界面已尝试恢复英文。');
    }
    for (const client of clients.values()) client.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
