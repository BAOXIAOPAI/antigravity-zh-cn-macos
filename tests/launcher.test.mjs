import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const helper = join(root, 'scripts/launcher.zsh');
const supportedHostNode = Number(process.versions.node.split('.')[0]) >= 22 && typeof WebSocket === 'function';

function findNode(candidates) {
  return spawnSync('/bin/zsh', ['-f', '-c', 'source "$1"; shift; ag_find_node "$@"', 'test', helper, ...candidates], { encoding: 'utf8' });
}

function fakeNode(path, eligible) {
  writeFileSync(path, `#!/bin/sh
if [ "$1" = '-e' ]; then exit ${eligible ? 0 : 1}; fi
printf '%s\\n' "$@" > "$AG_TEST_ARGUMENTS"
exit "\${AG_TEST_EXIT:-0}"
`, { mode: 0o755 });
}

test('launcher accepts an actual supported Node runtime', { skip: !supportedHostNode }, () => {
  const result = findNode([process.execPath]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), process.execPath);
});

test('launcher skips missing or unsupported runtimes and accepts paths with spaces', () => {
  const folder = mkdtempSync(join(tmpdir(), 'ag launcher '));
  try {
    const oldNode = join(folder, 'old-node');
    const newNode = join(folder, 'new node');
    fakeNode(oldNode, false);
    fakeNode(newNode, true);
    const result = findNode([join(folder, 'missing'), oldNode, newNode]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), newNode);
    assert.equal(findNode([oldNode]).status, 1);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

for (const [launcher, mode] of [['启动中文适配.command', '--restart'], ['恢复英文.command', '--restore']]) {
  test(`${launcher} passes the absolute project path, preserves mode and exit code`, () => {
    const folder = mkdtempSync(join(tmpdir(), 'ag public mac '));
    try {
      mkdirSync(join(folder, 'scripts'));
      mkdirSync(join(folder, 'runtime with spaces'));
      copyFileSync(helper, join(folder, 'scripts/launcher.zsh'));
      const entry = join(folder, launcher);
      copyFileSync(join(root, launcher), entry);
      fakeNode(join(folder, 'runtime with spaces/node'), true);
      const captured = join(folder, 'arguments.txt');
      const result = spawnSync('/bin/zsh', ['-f', entry], {
        cwd: tmpdir(), input: '\n', encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${join(folder, 'runtime with spaces')}:/usr/bin:/bin`,
          AG_TEST_ARGUMENTS: captured,
          AG_TEST_EXIT: '7'
        }
      });
      assert.equal(result.status, 7);
      assert.deepEqual(readFileSync(captured, 'utf8').trim().split('\n'), [join(realpathSync(folder), 'adapter.mjs'), mode]);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
}
