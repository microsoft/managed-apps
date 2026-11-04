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

function run(name, input, native = false, markers = {}) {
  const env = { ...process.env };
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'COPILOT_CLI', 'COPILOT_AGENT_SESSION_ID', 'MS_PLUGIN_REPORT_AGENT']) delete env[key];
  Object.assign(env, markers);
  const script = join(directory, 'hooks', `${name}.${windows ? 'ps1' : 'sh'}`);
  const args = windows ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script] : [script];
  if (native && name === 'pre-tool-use') args.push(windows ? '-GitHubCopilot' : '--github-copilot');
  const result = spawnSync(shell, args, { env, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
}

for (const [host, native, payload] of [
  ['shared Claude', false, command => ({ tool_name: windows ? 'powershell' : 'Bash', tool_input: { command, description: 'keep me' } })],
  ['shared Copilot', false, command => ({ toolName: shell, toolArgs: { command, description: 'keep me' } })],
  ['native Copilot', true, command => ({ toolName: shell, toolArgs: { command, description: 'keep me' } })],
]) {
  test(`${host}: attributes ms commands and preserves other arguments`, () => {
    for (const markers of [
      {},
      { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
      { COPILOT_CLI: '1', COPILOT_AGENT_SESSION_ID: 'test' },
      { CLAUDECODE: '1', COPILOT_CLI: '1', MS_PLUGIN_REPORT_AGENT: 'cursor' },
    ]) {
      const result = run('pre-tool-use', payload('ms app list --json'), native, markers);
      assert.match(result.updatedInput.command, windows ? /MS_CLI_ORIGIN = 'plugin'/ : /MS_CLI_ORIGIN-plugin}/);
      assert.doesNotMatch(result.updatedInput.command, /plugin\//);
      if (native) assert.match(result.updatedInput.command, /MS_PLUGIN_REPORT_AGENT\s*=\s*'github-copilot'/);
      else assert.match(result.updatedInput.command, windows ? /MS_PLUGIN_REPORT_AGENT = \$null/ : /unset -v MS_PLUGIN_REPORT_AGENT/);
      assert.equal(result.updatedInput.description, 'keep me');
      assert.deepEqual(result.modifiedArgs, result.updatedInput);
      assert.deepEqual(result.hookSpecificOutput.updatedInput, result.updatedInput);
    }
  });

  test(`${host}: leaves non-ms commands and explicit origins unchanged`, () => {
    const explicit = windows ? "$env:MS_CLI_ORIGIN = 'custom'; ms app list" : 'MS_CLI_ORIGIN=custom ms app list';
    for (const command of ['echo ms app list', 'node --version', 'terms list']) {
      const result = run('pre-tool-use', payload(command), native);
      assert.equal(result.updatedInput, undefined);
      assert.equal(result.modifiedArgs, undefined);
    }
    const result = run('pre-tool-use', payload(explicit), native);
    if (native) {
      const prefix = windows ? "$env:MS_PLUGIN_REPORT_AGENT = 'github-copilot'; " : "export MS_PLUGIN_REPORT_AGENT='github-copilot' && ";
      assert.equal(result.updatedInput.command, prefix + explicit);
    } else {
      const prefix = windows ? '$env:MS_PLUGIN_REPORT_AGENT = $null; ' : 'unset -v MS_PLUGIN_REPORT_AGENT && ';
      assert.equal(result.updatedInput.command, prefix + explicit);
    }
  });

  test(`${host}: preserves origins and applies package reports at command execution`, () => {
    const rewritten = run('pre-tool-use', payload('ms app list'), native).updatedInput.command;
    const probe = windows
      ? 'function ms { $report = if (Test-Path Env:MS_PLUGIN_REPORT_AGENT) { $env:MS_PLUGIN_REPORT_AGENT } else { "<unset>" }; Write-Output "$env:MS_CLI_ORIGIN|$report" }; '
      : 'ms() { printf "%s|%s" "$MS_CLI_ORIGIN" "${MS_PLUGIN_REPORT_AGENT-<unset>}"; }; ';
    for (const origin of [undefined, 'custom', '']) {
      // Windows PowerShell 5.1 removes empty environment variables.
      if (windows && origin === '') continue;
      for (const report of [undefined, 'cursor', '']) {
        const env = { ...process.env };
        if (origin === undefined) delete env.MS_CLI_ORIGIN;
        else env.MS_CLI_ORIGIN = origin;
        if (report === undefined) delete env.MS_PLUGIN_REPORT_AGENT;
        else env.MS_PLUGIN_REPORT_AGENT = report;
        const args = windows ? ['-NoProfile', '-Command', probe + rewritten] : ['-c', probe + rewritten];
        const result = spawnSync(shell, args, { env, encoding: 'utf8', timeout: 10000 });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), `${origin ?? 'plugin'}|${native ? 'github-copilot' : '<unset>'}`);
      }
    }
  });
}

test('Copilot native bash input receives bash syntax even on Windows', () => {
  const result = run('pre-tool-use', { toolName: 'bash', toolArgs: { command: 'ms app list' } }, true);
  assert.match(result.modifiedArgs.command, /^export MS_CLI_ORIGIN=/);
  assert.match(result.modifiedArgs.command, /export MS_PLUGIN_REPORT_AGENT='github-copilot' && ms app list$/);
});

test('session guidance supports both clients and skips compaction', () => {
  const result = run('session-start', { source: 'startup' });
  assert.match(result.additionalContext, /MS_CLI_ORIGIN/);
  assert.match(result.additionalContext, /MS_PLUGIN_REPORT_AGENT=github-copilot/);
  assert.doesNotMatch(result.additionalContext, /plugin\//);
  assert.equal(result.hookSpecificOutput.additionalContext, result.additionalContext);
  assert.equal(run('session-start', { source: 'compact' }), undefined);
});
