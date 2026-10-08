import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessageTimestamp } from './messageTimestamp.ts';

test('missing history timestamps can be sorted without crashing the chat', () => {
  const timestamps = [null, '2026-10-08T12:00:00+00:00', undefined]
    .map(normalizeMessageTimestamp)
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(timestamps, ['1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', '2026-10-08T12:00:00+00:00']);
});

test('invalid timestamps use a stable fallback and valid timestamps are preserved', () => {
  assert.equal(normalizeMessageTimestamp('invalid'), '1970-01-01T00:00:00.000Z');
  assert.equal(normalizeMessageTimestamp('2026-10-08T12:00:00Z'), '2026-10-08T12:00:00Z');
});
