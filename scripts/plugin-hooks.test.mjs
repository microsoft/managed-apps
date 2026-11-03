import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const shell = windows ? 'powershell' : 'bash';
const directory = mkdtempSync(join(tmpdir(), 'managed apps hooks '));
cpSync(join(root, 'plugins/microsoft-managed-apps/hooks'), join(directory, 'hooks'), { recursive: true });
test.after(() => rmSync(directory, { recursive: true, force: true }));

function run(name, input, host = 'copilot-cli') {
  const env = { ...process.env };
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'COPILOT_CLI', 'COPILOT_AGENT_SESSION_ID']) delete env[key];
  if (host === 'claude-code') env.CLAUDECODE = '1';
  if (host === 'copilot-cli') env.COPILOT_CLI = '1';
  const script = join(directory, 'hooks', `${name}.${windows ? 'ps1' : 'sh'}`);
  const args = windows ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script] : [script];
  const result = spawnSync(shell, args, { env, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
}

for (const [host, payload] of [
  ['claude-code', command => ({ tool_name: windows ? 'powershell' : 'Bash', tool_input: { command, description: 'keep me' } })],
  ['copilot-cli', command => ({ toolName: shell, toolArgs: { command, description: 'keep me' } })],
]) {
  test(`${host}: attributes ms commands and preserves other arguments`, () => {
    const result = run('pre-tool-use', payload('ms app list --json'), host);
    assert.match(result.updatedInput.command, new RegExp(`plugin/${host}`));
    assert.equal(result.updatedInput.description, 'keep me');
    assert.deepEqual(result.modifiedArgs, result.updatedInput);
    assert.deepEqual(result.hookSpecificOutput.updatedInput, result.updatedInput);
  });

  test(`${host}: leaves non-ms commands and explicit attribution unchanged`, () => {
    const explicit = windows ? "$env:MS_CLI_ORIGIN = 'custom'; ms app list" : 'MS_CLI_ORIGIN=custom ms app list';
    for (const command of ['echo ms app list', 'node --version', explicit]) {
      const result = run('pre-tool-use', payload(command), host);
      assert.equal(result.updatedInput, undefined);
      assert.equal(result.modifiedArgs, undefined);
    }
  });

  test(`${host}: preserves inherited attribution at command execution`, () => {
    const rewritten = run('pre-tool-use', payload('ms app list'), host).updatedInput.command;
    const probe = windows
      ? 'function ms { Write-Output $env:MS_CLI_ORIGIN }; '
      : 'ms() { printf "%s" "$MS_CLI_ORIGIN"; }; ';
    for (const origin of [undefined, 'custom', '']) {
      // Windows PowerShell 5.1 removes empty environment variables.
      if (windows && origin === '') continue;
      const env = { ...process.env };
      if (origin === undefined) delete env.MS_CLI_ORIGIN;
      else env.MS_CLI_ORIGIN = origin;
      const args = windows ? ['-NoProfile', '-Command', probe + rewritten] : ['-c', probe + rewritten];
      const result = spawnSync(shell, args, { env, encoding: 'utf8', timeout: 10000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), origin === undefined ? `plugin/${host}` : origin);
    }
  });
}

test('Copilot native bash input receives bash syntax even on Windows', () => {
  const result = run('pre-tool-use', { toolName: 'bash', toolArgs: { command: 'ms app list' } });
  assert.match(result.modifiedArgs.command, /^export MS_CLI_ORIGIN=/);
});

test('session guidance supports both clients and skips compaction', () => {
  const result = run('session-start', { source: 'startup' });
  assert.match(result.additionalContext, /MS_CLI_ORIGIN/);
  assert.equal(result.hookSpecificOutput.additionalContext, result.additionalContext);
  assert.equal(run('session-start', { source: 'compact' }), undefined);
});
