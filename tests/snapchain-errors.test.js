import test from 'node:test';
import assert from 'node:assert/strict';
import { isNotFound } from '../src/snapchain-errors.js';

test('recognizes missing-cast responses from status codes and legacy error text', () => {
  assert.equal(isNotFound(Object.assign(new Error('Cast not found'), { status: 404 })), true);
  assert.equal(isNotFound(new Error('Snapchain rejected the request (404). Cast not found')), true);
  assert.equal(isNotFound(Object.assign(new Error('Cast not found'), { status: 400 })), false);
  assert.equal(isNotFound(new Error('Snapchain is temporarily unavailable.')), false);
});
