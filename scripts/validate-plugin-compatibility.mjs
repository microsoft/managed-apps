import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    validate();
    console.log('Plugin manifests and marketplace entries are compatible.');
  } catch (error) {
    console.error(`Plugin compatibility check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
