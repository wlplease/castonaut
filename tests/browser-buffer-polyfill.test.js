import test from 'node:test';
import assert from 'node:assert/strict';

test('installs Buffer for Farcaster SDK browser validation helpers', async () => {
  const previous = globalThis.Buffer;
  try {
    delete globalThis.Buffer;
    await import(`../src/runtime-polyfills.js?test=${Date.now()}`);
    assert.equal(globalThis.Buffer.from('follow').toString(), 'follow');
    await import('../src/faker-compat.js');
    const { FarcasterNetwork, makeLinkAddData } = await import('@farcaster/core');
    const link = await makeLinkAddData({ type: 'follow', targetFid: 37 }, { fid: 123, network: FarcasterNetwork.MAINNET });
    assert.equal(link.isOk(), true, 'Farcaster follow builder works after installing the browser polyfill');
  } finally {
    globalThis.Buffer = previous;
  }
});
