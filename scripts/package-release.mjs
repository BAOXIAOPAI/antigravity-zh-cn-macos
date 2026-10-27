import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('macOS 发布包需要在 macOS 上使用系统 ditto 工具构建。');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('发布版本号格式不正确。');
const files = [
  'adapter.mjs', 'translator.js', 'zh-CN.json', 'package.json',
  '启动中文适配.command', '恢复英文.command', 'scripts/launcher.zsh',
  'README.md', '使用说明.md', 'LICENSE', 'CHANGELOG.md',
  'docs/translation-preview.png', 'scripts/package-release.mjs',
  'tests/adapter.test.mjs', 'tests/launcher.test.mjs', 'tests/fixture.html', 'tests/serve-fixture.mjs'
];
const scratch = mkdtempSync(join(tmpdir(), 'antigravity-zh-release-'));
const folder = join(scratch, 'Antigravity中文适配');
const output = join(root, 'dist', `Antigravity-zh-CN-macOS-v${version}.zip`);
try {
  for (const file of files) {
    const destination = join(folder, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, file), destination);
    if (file.endsWith('.command') || file.endsWith('.zsh')) chmodSync(destination, 0o755);
  }
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });
  const result = spawnSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', folder, output], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`打包失败，ditto 退出码 ${result.status}`);
  // ditto writes UTF-8 filename bytes without setting the ZIP UTF-8 flag.
  // Mark the local and central headers so other ZIP readers preserve Chinese names.
  const archive = readFileSync(output);
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('发布 ZIP 缺少目录记录。');
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('发布 ZIP 目录格式不正确。');
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const local = archive.readUInt32LE(offset + 42);
    if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error('发布 ZIP 文件头格式不正确。');
    new TextDecoder('utf-8', { fatal: true }).decode(archive.subarray(offset + 46, offset + 46 + nameLength));
    archive.writeUInt16LE(archive.readUInt16LE(offset + 8) | 0x0800, offset + 8);
    archive.writeUInt16LE(archive.readUInt16LE(local + 6) | 0x0800, local + 6);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  writeFileSync(output, archive);
  console.log(output);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
