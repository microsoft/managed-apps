import { describe, expect, it } from 'vitest';
import { LocalCommentStore } from '../LocalCommentStore';

describe('LocalCommentStore.deleteComment', () => {
  async function fixture() {
    const store = new LocalCommentStore();
    const root = await store.createThread({
      prKey: 'o/r#1', filename: 'a.ts', side: 'right', line: 1, body: 'root',
      author: { login: 'alice' },
    });
    const thread = await store.addComment('o/r#1', root.id, 'reply', { login: 'bob' });
    return { store, thread };
  }

  it.each([0, 1])('persists deletion of comment %i while keeping the other author and text', async (index) => {
    const { store, thread } = await fixture();
    const survivor = thread.comments[1 - index];
    await store.deleteComment('o/r#1', thread.id, thread.comments[index].id);
    const saved = await new LocalCommentStore().listThreads('o/r#1');
    expect(saved).toHaveLength(1);
    expect(saved[0].comments).toEqual([survivor]);
  });

  it('removes an empty thread only after its final comment is deleted', async () => {
    const { store, thread } = await fixture();
    for (const comment of thread.comments) {
      await store.deleteComment('o/r#1', thread.id, comment.id);
    }
    expect(await store.listThreads('o/r#1')).toEqual([]);
  });

  it('does not change storage when the PR, thread or comment does not exist', async () => {
    const { store, thread } = await fixture();
    await expect(store.deleteComment('o/r#2', thread.id, thread.comments[0].id)).rejects.toThrow('Thread not found');
    await expect(store.deleteComment('o/r#1', 'absent', thread.comments[0].id)).rejects.toThrow('Thread not found');
    await expect(store.deleteComment('o/r#1', thread.id, 'absent')).rejects.toThrow('Comment not found');
    expect((await store.listThreads('o/r#1'))[0].comments).toEqual(thread.comments);
  });
});
