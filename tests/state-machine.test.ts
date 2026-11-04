import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTransition, canTransition } from '../server/state-machine';

test('allows the approved four-state workflow', () => {
  assert.equal(canTransition('not_started', 'processing'), true);
  assert.equal(canTransition('processing', 'draft'), true);
  assert.equal(canTransition('draft', 'approved'), true);
  assert.equal(canTransition('draft', 'processing'), true);
  assert.equal(canTransition('approved', 'processing'), true);
});

test('rejects invalid shortcuts', () => {
  assert.equal(canTransition('not_started', 'approved'), false);
  assert.throws(() => assertTransition('approved', 'draft'), /Invalid document transition/);
});
