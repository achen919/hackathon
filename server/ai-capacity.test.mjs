import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiCapacityGate } from './ai-capacity.mjs';

test('AI capacity gate shares concurrency and hourly limits across callers', () => {
  let now = 1_000;
  const gate = createAiCapacityGate({ hourlyLimit: 2, maxConcurrency: 1, now: () => now });
  const first = gate.acquire();
  assert.equal(first.allowed, true);
  assert.equal(gate.acquire().reason, 'concurrency');
  first.release();
  const second = gate.acquire();
  assert.equal(second.allowed, true);
  second.release();
  assert.equal(gate.acquire().reason, 'hourly-limit');
  now += 60 * 60_000;
  const afterReset = gate.acquire();
  assert.equal(afterReset.allowed, true);
  afterReset.release();
});
