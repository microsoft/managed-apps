import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validate } from './validate-plugin-compatibility.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = 'plugins/microsoft-managed-apps/plugin.json';
const legacy = 'plugins/microsoft-managed-apps/.claude-plugin/plugin.json';
const marketplace = '.claude-plugin/marketplace.json';
const codex = '.agents/plugins/marketplace.json';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'managed-apps-compatibility-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const path of [canonical, legacy, marketplace, codex]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    copyFileSync(join(root, path), join(directory, path));
  }
  return directory;
}

function edit(directory, path, change) {
  const file = join(directory, path);
  const value = JSON.parse(readFileSync(file, 'utf8'));
  change(value);
  writeFileSync(file, JSON.stringify(value));
}

test('repository manifests pass', () => validate());

test('comparison ignores formatting and object key order', t => {
  const directory = fixture(t);
  const file = join(directory, legacy);
  const value = JSON.parse(readFileSync(file, 'utf8'));
  value.author = Object.fromEntries(Object.entries(value.author).reverse());
  writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(value).reverse())));
  validate(directory);
});

for (const [name, path, change, message] of [
  ['legacy version drift', legacy, value => { value.version = '0.0.0'; }, /legacy plugin.json must match/],
  ['nested metadata drift', legacy, value => { value.author.name = 'Changed'; }, /legacy plugin.json must match/],
  ['missing schema', canonical, value => { delete value.$schema; }, /must declare/],
  ['unsupported schema', canonical, value => { value.$schema = 'https://example.com/schema'; }, /must declare/],
  ['unexpected legacy schema', legacy, value => { value.$schema = 'extra'; }, /legacy plugin.json must match/],
  ['invalid name', canonical, value => { value.name = 'invalid--name'; }, /invalid plugin.json name/],
  ['unknown field', canonical, value => { value.skills = './skills'; }, /unknown field/],
  ['invalid metadata type', canonical, value => { value.version = 1; }, /version must be a string/],
  ['invalid author field', canonical, value => { value.author.extra = 'x'; }, /author has an unknown field/],
  ['invalid keyword', canonical, value => { value.keywords = [1]; }, /keywords must contain strings/],
  ['invalid extensions', canonical, value => { value.extensions = { 'com.example': [] }; }, /extension values must be objects/],
  ['marketplace version drift', marketplace, value => { value.plugins[0].version = '0.0.0'; }, /marketplace version must match/],
  ['marketplace source drift', marketplace, value => { value.plugins[0].source = './wrong'; }, /source path/],
  ['missing marketplace entry', marketplace, value => { value.plugins = []; }, /exactly one matching plugin/],
  ['duplicate marketplace entry', marketplace, value => { value.plugins.push(value.plugins[0]); }, /exactly one matching plugin/],
  ['Codex source drift', codex, value => { value.plugins[0].source.path = './wrong'; }, /same plugin directory/],
]) {
  test(`rejects ${name}`, t => {
    const directory = fixture(t);
    edit(directory, path, change);
    assert.throws(() => validate(directory), message);
  });
}

for (const path of [canonical, legacy, marketplace, codex]) {
  test(`rejects malformed JSON: ${path}`, t => {
    const directory = fixture(t);
    writeFileSync(join(directory, path), '../plugin.json');
    assert.throws(() => validate(directory), /Unexpected token/);
  });

  test(`rejects a non-object: ${path}`, t => {
    const directory = fixture(t);
    writeFileSync(join(directory, path), 'null');
    assert.throws(() => validate(directory), /must contain a JSON object/);
  });

  test(`rejects a missing file: ${path}`, t => {
    const directory = fixture(t);
    rmSync(join(directory, path));
    assert.throws(() => validate(directory), /ENOENT/);
  });

  test(`rejects a symlink: ${path}`, t => {
    const directory = fixture(t);
    const file = join(directory, path);
    const target = join(directory, 'target.json');
    copyFileSync(file, target);
    rmSync(file);
    try {
      symlinkSync(target, file, 'file');
    } catch (error) {
      if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
      t.skip('Windows requires permission to create file symlinks. Linux CI covers this case.');
      return;
    }
    assert.throws(() => validate(directory), /must be a regular file/);
  });
}
