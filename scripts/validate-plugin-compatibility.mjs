import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginPath = 'plugins/microsoft-managed-apps';
const schema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(directory, path) {
  const file = resolve(directory, path);
  assert.ok(lstatSync(file).isFile(), `${path} must be a regular file, not a symlink`);
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`, { cause: error });
  }
  assert.ok(isObject(value), `${path} must contain a JSON object`);
  return value;
}

function regularFile(plugin, path) {
  const file = resolve(plugin, path);
  const contained = relative(realpathSync(plugin), realpathSync(file));
  assert.ok(!isAbsolute(contained) && contained !== '..' && !contained.startsWith(`..${sep}`),
    `${path} must remain inside the plugin`);
  assert.ok(lstatSync(file).isFile(), `${path} must be a regular file, not a symlink`);
  return readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
}

function validateComponents(directory) {
  const plugin = resolve(directory, pluginPath);
  const agent = 'microsoft-apps-architect';
  assert.deepEqual(readdirSync(resolve(plugin, 'agents')).sort(), [`${agent}.md`],
    'legacy architect agent must remain discoverable');
  assert.deepEqual(readdirSync(resolve(plugin, 'com.github.copilot/agents')).sort(), [`${agent}.agent.md`],
    'Copilot architect agent must remain discoverable without duplicates');
  assert.equal(regularFile(plugin, `com.github.copilot/agents/${agent}.agent.md`),
    regularFile(plugin, `agents/${agent}.md`).replaceAll('../shared/', '../../shared/'),
    'Copilot agent must match the legacy agent except for relative resource paths');

  const legacy = readJson(directory, `${pluginPath}/hooks/hooks.json`);
  assert.deepEqual(Object.keys(legacy.hooks).sort(), ['PreToolUse', 'SessionStart'],
    'preserve both legacy attribution hooks');
  const hooks = {};
  for (const [event, name] of [['SessionStart', 'sessionStart'], ['PreToolUse', 'preToolUse']]) {
    assert.equal(legacy.hooks[event].length, 1, `preserve one ${event} matcher`);
    const group = legacy.hooks[event][0];
    hooks[name] = group.hooks.map(hook => {
      for (const command of [hook.command, hook.bash, hook.powershell]) {
        assert.equal(typeof command, 'string', `${event} must support both shells`);
        const matches = [...command.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/g)];
        assert.equal(matches.length, 1, `${event} must use a plugin-root script path`);
        regularFile(plugin, matches[0][1]);
      }
      return {
        type: hook.type,
        ...(event === 'PreToolUse' ? { matcher: group.matcher } : {}),
        bash: hook.bash.replaceAll('${CLAUDE_PLUGIN_ROOT}', '${PLUGIN_ROOT}'),
        powershell: hook.powershell.replaceAll('${CLAUDE_PLUGIN_ROOT}', '${PLUGIN_ROOT}'),
        env: { COPILOT_CLI: '1' },
        timeoutSec: hook.timeoutSec,
      };
    });
    assert.equal(hooks[name].length, 1, `preserve one ${event} command`);
  }
  const copilot = readJson(directory, `${pluginPath}/com.github.copilot/hooks/hooks.json`);
  assert.deepEqual(copilot, { version: 1, hooks },
    'Copilot hooks must match the legacy scripts, matchers, and timeouts with native root paths');

  for (const base of ['skills', 'shared', 'agents', 'com.github.copilot/agents']) {
    const visit = folder => {
      assert.ok(lstatSync(folder).isDirectory(), `${folder} must be a regular directory, not a symlink`);
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const file = resolve(folder, entry.name);
        assert.ok(!entry.isSymbolicLink(), `${file} must not be a symlink`);
        if (entry.isDirectory()) visit(file);
        else if (entry.name.endsWith('.md')) {
          const text = regularFile(plugin, relative(plugin, file));
          assert.ok(!/\$\{(?:CLAUDE_)?PLUGIN_ROOT\}/.test(text),
            `${relative(plugin, file)} must use document-relative resource paths`);
          for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
            if (!target.startsWith('./') && !target.startsWith('../')) continue;
            regularFile(plugin, relative(plugin, resolve(dirname(file), target.split('#')[0])));
          }
        }
      }
    };
    visit(resolve(plugin, base));
  }
}

// Agent Plugins 1.0.0 has a small, closed manifest schema.
function validateManifest(manifest) {
  assert.equal(manifest.$schema, schema, 'plugin.json must declare the Agent Plugins 1.0.0 schema');
  assert.equal(typeof manifest.name, 'string', 'plugin.json name must be a string');
  assert.ok(manifest.name.length <= 64, 'plugin.json name must not exceed 64 characters');
  assert.match(manifest.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/, 'invalid plugin.json name');

  const strings = ['version', 'description', 'homepage', 'repository', 'license'];
  const fields = ['$schema', 'name', ...strings, 'author', 'keywords', 'extensions'];
  for (const key of Object.keys(manifest)) {
    assert.ok(fields.includes(key), `plugin.json has an unknown field: ${key}`);
  }
  for (const key of strings) {
    if (key in manifest) assert.equal(typeof manifest[key], 'string', `plugin.json ${key} must be a string`);
  }
  if ('author' in manifest) {
    assert.ok(isObject(manifest.author), 'plugin.json author must be an object');
    for (const [key, value] of Object.entries(manifest.author)) {
      assert.ok(['name', 'email', 'url'].includes(key), `plugin.json author has an unknown field: ${key}`);
      assert.equal(typeof value, 'string', `plugin.json author.${key} must be a string`);
    }
  }
  if ('keywords' in manifest) {
    assert.ok(Array.isArray(manifest.keywords), 'plugin.json keywords must be an array');
    assert.ok(manifest.keywords.every(value => typeof value === 'string'), 'plugin.json keywords must contain strings');
  }
  if ('extensions' in manifest) {
    assert.ok(isObject(manifest.extensions), 'plugin.json extensions must be an object');
    assert.ok(Object.values(manifest.extensions).every(isObject), 'plugin.json extension values must be objects');
  }
}

export function validate(directory = root) {
  const canonical = readJson(directory, `${pluginPath}/plugin.json`);
  const legacy = readJson(directory, `${pluginPath}/.claude-plugin/plugin.json`);
  validateManifest(canonical);
  const { $schema, ...metadata } = canonical;
  assert.deepEqual(legacy, metadata, 'legacy plugin.json must match the canonical manifest except for $schema');

  const marketplace = readJson(directory, '.claude-plugin/marketplace.json');
  assert.equal(marketplace.name, 'Managed-Apps', 'preserve the existing marketplace identity');
  assert.ok(Array.isArray(marketplace.plugins), 'legacy marketplace plugins must be an array');
  const entries = marketplace.plugins.filter(entry => entry?.name === canonical.name);
  assert.equal(entries.length, 1, 'legacy marketplace must contain exactly one matching plugin');
  assert.equal(canonical.name, 'microsoft-managed-apps', 'preserve the existing plugin identity');
  assert.equal(entries[0].source, `./${pluginPath}`, 'preserve the existing plugin source path');
  for (const key of ['version', 'description']) {
    assert.equal(typeof canonical[key], 'string', `this plugin must declare ${key}`);
    assert.equal(entries[0][key], canonical[key], `legacy marketplace ${key} must match plugin.json`);
  }

  const codex = readJson(directory, '.agents/plugins/marketplace.json');
  assert.equal(codex.name, marketplace.name, 'marketplace identities must match');
  assert.ok(Array.isArray(codex.plugins), 'Codex marketplace plugins must be an array');
  const codexEntries = codex.plugins.filter(entry => entry?.name === canonical.name);
  assert.equal(codexEntries.length, 1, 'Codex marketplace must contain exactly one matching plugin');
  assert.deepEqual(codexEntries[0].source, { source: 'local', path: `./${pluginPath}` }, 'Codex must use the same plugin directory');
  validateComponents(directory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    validate();
    console.log('Plugin manifests, components, and resource paths are compatible.');
  } catch (error) {
    console.error(`Plugin compatibility check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
