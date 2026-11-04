import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runProviderContract } from '../contract';
import { ConflictError } from '../errors';
import { createInMemoryTableBackend, createTableBackedProvider, type TableBackend } from '../providers/tableBacked';

function makeProvider() {
  const tables = new Map<string, TableBackend>();
  return createTableBackedProvider({
    id: 'table-fake',
    shared: true,
    tableFor: (name) => {
      let table = tables.get(name);
      if (!table) {
        table = createInMemoryTableBackend();
        tables.set(name, table);
      }
      return table;
    },
  });
}

runProviderContract('table-backed (in-memory backend)', makeProvider);

describe('table-backed provider', () => {
  const ITEMS = { name: 'items', schema: z.object({ name: z.string() }) };

  it('skips rows that are not valid JSON or fail the schema', async () => {
    const backend = createInMemoryTableBackend();
    await backend.create('bad-json', '{oops');
    await backend.create('bad-shape', JSON.stringify({ name: 1 }));
    await backend.create('good', JSON.stringify({ name: 'ok' }));
    const onWarning = vi.fn();
    const provider = createTableBackedProvider({ id: 't', shared: true, tableFor: () => backend, onWarning });
    expect((await provider.collection(ITEMS).listAll()).map((i) => i.id)).toEqual(['good']);
    expect(onWarning).toHaveBeenCalledTimes(2);
  });

  it('surfaces backend etag conflicts', async () => {
    const backend = createInMemoryTableBackend();
    const provider = createTableBackedProvider({ id: 't', shared: true, tableFor: () => backend });
    const items = provider.collection(ITEMS);
    const created = await items.create({ name: 'a' });
    await backend.update(created.id, JSON.stringify({ name: 'changed elsewhere' }));
    await expect(items.update(created.id, { name: 'b' }, { ifVersion: created.version })).rejects.toBeInstanceOf(ConflictError);
  });

  it('refresh notifies subscribers', () => {
    const provider = makeProvider();
    const onChange = vi.fn();
    provider.collection(ITEMS).subscribe(onChange);
    provider.refresh();
    provider.refresh('items');
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
