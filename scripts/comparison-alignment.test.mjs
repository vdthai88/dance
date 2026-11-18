import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSongAlignment, sameSongAlignment } from '../app/lib/comparison-alignment.ts';

test('failed or absent alignment cannot silently become two zero markers', () => {
  for (const source of [null, undefined, '', 'failed', 'pending']) {
    assert.equal(parseSongAlignment('0', '0', source), null);
  }
  for (const invalid of [null, undefined, '', ' ', 'NaN', 'Infinity', '-1', {}, 5]) {
    assert.equal(parseSongAlignment(invalid, '15', 'auto'), null);
    assert.equal(parseSongAlignment('5', invalid, 'manual'), null);
  }
});

test('automatic and manually confirmed starts preserve fractional seconds', () => {
  assert.deepEqual(parseSongAlignment('15', '5.75', 'manual'), { earlierSongStart: 15, newerSongStart: 5.75, source: 'manual' });
  assert.deepEqual(parseSongAlignment('0', '0', 'auto'), { earlierSongStart: 0, newerSongStart: 0, source: 'auto' });
});

test('correcting alignment cannot reuse a comparison generated with zero or other markers', () => {
  const alignment = parseSongAlignment('15', '5.75', 'manual');
  assert.equal(sameSongAlignment({ earlierSongStart: 0, newerSongStart: 0 }, alignment), false);
  assert.equal(sameSongAlignment({}, alignment), false);
  assert.equal(sameSongAlignment({ earlierSongStart: 15, newerSongStart: 6 }, alignment), false);
  assert.equal(sameSongAlignment({ earlierSongStart: 15, newerSongStart: 5.75 }, alignment), true);
});
