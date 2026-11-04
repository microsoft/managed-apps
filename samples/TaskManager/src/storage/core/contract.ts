import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import type { StorageProvider } from './types';

/**
 * Behavioural contract every StorageProvider must satisfy. A new provider (SharePoint,
 * Dataverse, REST, …) is done when this suite passes against it:
 *
 *   runProviderContract('sharepoint', () => createSharePointProvider(fakeConnector()));
 *
 * `makeProvider` must return an isolated, empty provider on every call.
 */
const noteSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(''),
  tags: z.array(z.string()).default([]),
  priority: z.number().int().default(0),
  done: z.boolean().default(false),
});
type Note = z.infer<typeof noteSchema>;
const NOTES = { name: 'contractNotes', schema: noteSchema };

function note(title: string, extra: Partial<Note> = {}): Note {
  return { title, body: '', tags: [], priority: 0, done: false, ...extra };
}

export function runProviderContract(
  label: string,
  makeProvider: () => StorageProvider | Promise<StorageProvider>,
): void {
  describe(`StorageProvider contract: ${label}`, () => {
    let provider: StorageProvider;
    beforeEach(async () => {
      provider = await makeProvider();
    });

    it('creates, reads and lists records with metadata', async () => {
      const notes = provider.collection(NOTES);
      const created = await notes.create(note('first'));
      expect(created.id).toBeTruthy();
      expect(created.version).toBeTruthy();
      expect(created.createdAt).toBeTruthy();
      expect(created.updatedAt).toBeTruthy();
      expect(await notes.get(created.id)).toMatchObject({ title: 'first', id: created.id });
      expect((await notes.listAll()).map((n) => n.title)).toEqual(['first']);
    });

    it('returns undefined for a missing record', async () => {
      expect(await provider.collection(NOTES).get('missing')).toBeUndefined();
    });

    it('honours caller-chosen ids and rejects duplicates', async () => {
      const notes = provider.collection(NOTES);
      await notes.create(note('a'), { id: 'fixed' });
      await expect(notes.create(note('b'), { id: 'fixed' })).rejects.toBeInstanceOf(ConflictError);
    });

    it('validates writes against the schema', async () => {
      const notes = provider.collection(NOTES);
      await expect(notes.create({ ...note(''), title: '' })).rejects.toBeInstanceOf(ValidationError);
    });

    it('updates by merging and bumps the version', async () => {
      const notes = provider.collection(NOTES);
      const created = await notes.create(note('a', { body: 'keep' }));
      const updated = await notes.update(created.id, { title: 'b' });
      expect(updated).toMatchObject({ title: 'b', body: 'keep', createdAt: created.createdAt });
      expect(updated.version).not.toBe(created.version);
    });

    it('fails to update a missing record', async () => {
      await expect(provider.collection(NOTES).update('missing', { title: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    });

    it('enforces ifVersion on update, put and delete when supported', async () => {
      if (provider.capabilities.concurrency !== 'version') return;
      const notes = provider.collection(NOTES);
      const created = await notes.create(note('a'));
      const updated = await notes.update(created.id, { title: 'b' }, { ifVersion: created.version });
      await expect(notes.update(created.id, { title: 'c' }, { ifVersion: created.version })).rejects.toBeInstanceOf(ConflictError);
      await expect(notes.put(created.id, note('d'), { ifVersion: created.version })).rejects.toBeInstanceOf(ConflictError);
      await expect(notes.delete(created.id, { ifVersion: created.version })).rejects.toBeInstanceOf(ConflictError);
      await notes.delete(created.id, { ifVersion: updated.version });
      expect(await notes.get(created.id)).toBeUndefined();
    });

    it('put creates or replaces', async () => {
      const notes = provider.collection(NOTES);
      const first = await notes.put('k', note('a', { body: 'x' }));
      const second = await notes.put('k', note('b'));
      expect(second).toMatchObject({ id: 'k', title: 'b', body: '' });
      expect(second.createdAt).toBe(first.createdAt);
    });

    it('delete is idempotent', async () => {
      const notes = provider.collection(NOTES);
      const created = await notes.create(note('a'));
      await notes.delete(created.id);
      await notes.delete(created.id);
      expect(await notes.listAll()).toEqual([]);
    });

    it('filters, sorts and pages', async () => {
      const notes = provider.collection(NOTES);
      for (let i = 0; i < 5; i++) {
        await notes.create(note(`n${i}`, { priority: i, done: i % 2 === 0, tags: i > 2 ? ['hot'] : [] }));
      }
      const done = await notes.listAll({ where: [{ field: 'done', op: 'eq', value: true }], orderBy: [{ field: 'priority', direction: 'desc' }] });
      expect(done.map((n) => n.priority)).toEqual([4, 2, 0]);
      const hot = await notes.listAll({ where: [{ field: 'tags', op: 'contains', value: 'hot' }] });
      expect(hot.map((n) => n.title).sort()).toEqual(['n3', 'n4']);
      const ranged = await notes.listAll({ where: [{ field: 'priority', op: 'gte', value: 1 }, { field: 'priority', op: 'lt', value: 3 }] });
      expect(ranged.map((n) => n.priority).sort()).toEqual([1, 2]);
      const inSet = await notes.listAll({ where: [{ field: 'title', op: 'in', value: ['n0', 'n4'] }] });
      expect(inSet).toHaveLength(2);

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await notes.list({ orderBy: [{ field: 'priority' }], limit: 2, cursor });
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items.map((n) => n.title));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    });

    it('notifies subscribers on change and stops after unsubscribe', async () => {
      const notes = provider.collection(NOTES);
      let calls = 0;
      const unsubscribe = notes.subscribe(() => calls++);
      const created = await notes.create(note('a'));
      await notes.update(created.id, { title: 'b' });
      await notes.delete(created.id);
      expect(calls).toBeGreaterThanOrEqual(3);
      unsubscribe();
      const before = calls;
      await notes.create(note('c'));
      expect(calls).toBe(before);
    });

    it('stores validated key/value data', async () => {
      const prefs = provider.kv('prefs');
      await prefs.ready();
      const schema = z.object({ theme: z.enum(['light', 'dark']) });
      expect(prefs.get('ui', schema)).toBeUndefined();
      const changed: string[] = [];
      const unsubscribe = prefs.subscribe((key) => changed.push(key));
      prefs.set('ui', { theme: 'dark' });
      expect(prefs.get('ui', schema)).toEqual({ theme: 'dark' });
      expect(prefs.keys()).toContain('ui');
      prefs.set('bad', { theme: 'neon' });
      expect(prefs.get('bad', schema)).toBeUndefined();
      prefs.remove('ui');
      expect(prefs.get('ui', schema)).toBeUndefined();
      expect(changed).toContain('ui');
      unsubscribe();
    });

    it('round-trips export and import', async () => {
      const notes = provider.collection(NOTES);
      const created = await notes.create(note('keep', { tags: ['x'] }));
      provider.kv('prefs').set('mode', 'compact');
      const snapshot = await provider.exportAll();

      const target = await makeProvider();
      const targetNotes = target.collection(NOTES);
      await targetNotes.create(note('existing'));
      await target.importAll(snapshot, { mode: 'replace' });
      const imported = await targetNotes.listAll();
      expect(imported.map((n) => n.title)).toEqual(['keep']);
      expect(imported[0].id).toBe(created.id);
      expect(target.kv('prefs').get('mode', z.string())).toBe('compact');
    });
  });
}
