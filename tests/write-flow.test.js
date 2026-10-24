import test from 'node:test';
import assert from 'node:assert/strict';
import { publishWithConfirmation, removeWithConfirmation } from '../src/write-flow.js';

function notFound() { return Object.assign(new Error('not found'), { notFound: true }); }

test('mocked post, reply, like, and follow writes wait for delayed merge before success', async () => {
  for (const kind of ['post', 'reply', 'like', 'follow']) {
    let merged = false;
    let attempts = 0;
    let submissions = 0;
    const statuses = [];
    const outcome = await publishWithConfirmation({
      lookup: async () => { if (!merged) throw notFound(); },
      submit: async () => { submissions++; return { accepted: true, kind }; },
      onStatus: (text, status) => statuses.push(status),
      successText: `${kind} confirmed`,
      waitForMerge: async () => { while (!merged && attempts < 2) attempts++; if (attempts === 2) merged = true; return merged; },
    });
    assert.deepEqual(outcome, { accepted: true, kind });
    assert.equal(submissions, 1, `${kind} submitted once`);
    assert.deepEqual(statuses, ['pending', 'success']);
  }
});

test('publish recovers when submit loses its response after node merge', async () => {
  let merged = false;
  const outcome = await publishWithConfirmation({
    lookup: async () => { if (!merged) throw notFound(); },
    submit: async () => { merged = true; throw new Error('connection closed'); },
    onStatus() {},
    successText: 'post confirmed',
    waitForMerge: async () => merged,
  });
  assert.deepEqual(outcome, { alreadyMerged: true });
});

test('publish reports a delayed confirmation without asking for another write', async () => {
  let submissions = 0;
  await assert.rejects(publishWithConfirmation({
    lookup: async () => { throw notFound(); },
    submit: async () => { submissions++; return { accepted: true }; },
    onStatus() {},
    successText: 'post confirmed',
    waitForMerge: async () => false,
  }), /not confirmed yet/);
  assert.equal(submissions, 1);
});

test('mocked unfollow and unlike recover from delayed removal and replay', async () => {
  for (const kind of ['unfollow', 'unlike']) {
    let exists = true;
    let attempts = 0;
    let submissions = 0;
    const outcome = await removeWithConfirmation({
      lookup: async () => { if (!exists) throw notFound(); },
      submit: async () => { submissions++; return { accepted: true }; },
      onStatus() {},
      successText: `${kind} confirmed`,
      waitForRemoval: async () => { while (exists && attempts < 2) attempts++; if (attempts === 2) exists = false; return !exists; },
    });
    assert.equal(outcome, undefined);
    assert.equal(submissions, 1);
  }

  const replay = await removeWithConfirmation({
    lookup: async () => { throw notFound(); },
    submit: async () => assert.fail('already removed must not submit again'),
    onStatus() {},
    successText: 'unfollow confirmed',
    waitForRemoval: async () => true,
  });
  assert.deepEqual(replay, { alreadyRemoved: true });
});
