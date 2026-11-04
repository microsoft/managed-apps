import { describe, expect, it } from 'vitest';
import { applyVote, createTopic, fetchTopics, hasVoted, isMine, linkTopic, matchTopics, setVote, unlinkTopic } from '../lib/topics';
import { ADA, BEN, makeStorage } from './helpers';

describe('topics', () => {
  it('creates a topic with the requester as first voter (by user id)', async () => {
    const storage = makeStorage();
    const topic = await createTopic(storage, { name: 'Testing React hooks', details: 'With fakes', me: ADA });
    expect(topic).toMatchObject({ name: 'Testing React hooks', requestedBy: ADA.id, voters: [ADA.id], voteCount: 1, status: 'open' });
    expect(isMine(topic, ADA.id)).toBe(true);
    expect(isMine(topic, BEN.id)).toBe(false);
  });

  it('rejects an empty title', async () => {
    const storage = makeStorage();
    await expect(createTopic(storage, { name: '   ', details: '', me: ADA })).rejects.toThrow(/Couldn’t add your topic/);
  });

  it('sets and clears votes idempotently', async () => {
    const storage = makeStorage();
    const topic = await createTopic(storage, { name: 'Accessibility', details: '', me: ADA });
    const voted = await setVote(storage, topic.itemId, BEN, true);
    expect(voted.voters.sort()).toEqual([ADA.id, BEN.id].sort());
    expect(hasVoted(voted, BEN.id)).toBe(true);
    // Setting the same vote twice doesn't double count.
    expect((await setVote(storage, topic.itemId, BEN, true)).voteCount).toBe(2);
    const cleared = await setVote(storage, topic.itemId, BEN, false);
    expect(cleared.voters).toEqual([ADA.id]);
  });

  it('keeps both votes when two people vote at the same time (conflict retry)', async () => {
    const storage = makeStorage();
    const topic = await createTopic(storage, { name: 'Accessibility', details: '', me: ADA });
    const carol = { id: 'user-carol', displayName: 'Carol Demo' };
    await Promise.all([setVote(storage, topic.itemId, BEN, true), setVote(storage, topic.itemId, carol, true)]);
    const [stored] = await fetchTopics(storage);
    expect(stored.voters.sort()).toEqual([ADA.id, BEN.id, carol.id].sort());
  });

  it('applyVote toggles the optimistic copy', async () => {
    const storage = makeStorage();
    const topic = await createTopic(storage, { name: 'Accessibility', details: '', me: ADA });
    expect(applyVote(topic, BEN.id, true).voteCount).toBe(2);
    expect(applyVote(topic, ADA.id, false).voteCount).toBe(0);
  });

  it('never steals a topic that is linked to another date', async () => {
    const storage = makeStorage();
    const topic = await createTopic(storage, { name: 'Accessibility', details: '', me: ADA });
    expect((await linkTopic(storage, topic.itemId, '2031-03-06')).linked).toBe(true);
    const second = await linkTopic(storage, topic.itemId, '2031-03-13');
    expect(second.linked).toBe(false);
    await unlinkTopic(storage, topic.itemId, '2031-03-06');
    expect((await fetchTopics(storage))[0]).toMatchObject({ status: 'open', sessionRef: '' });
  });

  it('matches similar requests for the composer', async () => {
    const storage = makeStorage();
    await createTopic(storage, { name: 'Intro to accessibility testing', details: '', me: ADA });
    await createTopic(storage, { name: 'Cooking with data', details: '', me: ADA });
    const matches = matchTopics('accessibility', await fetchTopics(storage));
    expect(matches.map((t) => t.name)).toEqual(['Intro to accessibility testing']);
  });
});
