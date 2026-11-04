import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runProviderContract } from '../contract';
import { ConflictError, QuotaExceededError } from '../errors';
import { describeCollections } from '../describe';
import { createMemoryProvider, MemoryStorage } from '../providers/memory';
import { createWebStorageProvider } from '../providers/webStorage';
import { withConflictRetry } from '../retry';
import { readSnapshotFile } from '../snapshotFiles';

runProviderContract('memory', () => createMemoryProvider());

const item = z.object({ name: z.string() });
const ITEMS = { name: 'items', schema: item };

describe('web storage provider', () => {
  it('isolates apps by prefix', async () => {
    const storage = new MemoryStorage();
    const a = createWebStorageProvider({ storage, prefix: 'app-a' });
    const b = createWebStorageProvider({ storage, prefix: 'app-b' });
    await a.collection(ITEMS).create({ name: 'only-a' });
    expect(await b.collection(ITEMS).listAll()).toEqual([]);
  });

  it('quarantines records that no longer match the schema', async () => {
    const storage = new MemoryStorage();
    const onWarning = vi.fn();
    const provider = createWebStorageProvider({ storage, prefix: 'p', onWarning });
    const items = provider.collection(ITEMS);
    await items.create({ name: 'good' });
    const blob = JSON.parse(storage.getItem('p:c:items') ?? '{}');
    blob.items.bad = { id: 'bad', version: '1', createdAt: 'x', updatedAt: 'x', name: 42 };
    storage.setItem('p:c:items', JSON.stringify(blob));

    expect((await items.listAll()).map((i) => i.name)).toEqual(['good']);
    expect(onWarning).toHaveBeenCalled();
    expect(JSON.parse(storage.getItem('p:quarantine:items') ?? '[]')).toHaveLength(1);
  });

  it('survives a corrupt collection blob', async () => {
    const storage = new MemoryStorage();
    storage.setItem('p:c:items', '{not json');
    const provider = createWebStorageProvider({ storage, prefix: 'p', onWarning: () => {} });
    expect(await provider.collection(ITEMS).listAll()).toEqual([]);
    expect(storage.getItem('p:quarantine:items')).toBe('{not json');
  });

  it('maps quota errors', async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    const provider = createWebStorageProvider({ storage, prefix: 'p' });
    await expect(provider.collection(ITEMS).create({ name: 'x' })).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('emits changes from storage events (other tabs)', () => {
    const target = new EventTarget();
    const provider = createWebStorageProvider({ storage: new MemoryStorage(), prefix: 'p', eventTarget: target as unknown as Window });
    const onChange = vi.fn();
    provider.collection(ITEMS).subscribe(onChange);
    const event = new Event('storage') as Event & { key: string };
    Object.defineProperty(event, 'key', { value: 'p:c:items' });
    target.dispatchEvent(event);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('withConflictRetry', () => {
  it('retries on conflict and rethrows other errors', async () => {
    let attempts = 0;
    const result = await withConflictRetry(async () => {
      attempts++;
      if (attempts < 3) throw new ConflictError('c', 'id');
      return 'ok';
    });
    expect(result).toBe('ok');
    await expect(withConflictRetry(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await expect(withConflictRetry(async () => {
      throw new ConflictError('c', 'id');
    }, { attempts: 2 })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('describeCollections', () => {
  it('emits JSON Schema per collection', () => {
    const [description] = describeCollections([{ ...ITEMS, description: 'Things' }]);
    expect(description.name).toBe('items');
    expect(description.schema).toMatchObject({ type: 'object', properties: { name: { type: 'string' } } });
  });
});

describe('readSnapshotFile', () => {
  it('explains why a file was rejected', async () => {
    await expect(readSnapshotFile(new Blob(['{nope']))).rejects.toThrow('not valid JSON');
    await expect(readSnapshotFile(new Blob(['{"a":1}']))).rejects.toThrow('not a data export');
  });
});
