import test from 'node:test';
import assert from 'node:assert/strict';
import { orbitAtlasLayout } from '../src/orbit-atlas.js';

test('Orbit Atlas places every pinned person within the responsive board', () => {
  const nodes = orbitAtlasLayout(Array.from({ length: 24 }, (_, index) => index + 1));
  assert.equal(nodes.length, 24);
  assert.deepEqual(new Set(nodes.map((node) => node.ring)), new Set([0, 1, 2]));
  for (const node of nodes) {
    assert.ok(node.x > 1 && node.x < 99);
    assert.ok(node.y > 1 && node.y < 99);
  }
});

test('Orbit Atlas is stable and caps layout to the Desk pin limit', () => {
  const fids = Array.from({ length: 30 }, (_, index) => index + 100);
  assert.deepEqual(orbitAtlasLayout(fids), orbitAtlasLayout(fids));
  assert.equal(orbitAtlasLayout(fids).length, 24);
  assert.deepEqual(orbitAtlasLayout([]), []);
});
