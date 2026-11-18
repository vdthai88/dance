import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAudioFrames } from '../app/lib/clip-alignment.ts';

function noise(index, channel, seed = 1) {
  const value = Math.sin(index * 127.1 + channel * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}
function clip(start, pause, seed = 1) {
  return Array.from({ length: 241 }, (_, frame) => {
    const time = frame * 0.05;
    const songFrame = frame - Math.round(start / 0.05);
    const quiet = pause && time >= start - 0.6 && time < start;
    return {
      time,
      rms: quiet ? 0 : songFrame >= 0 ? 0.1 + 0.15 * noise(songFrame, 0, seed) : 0.08 + 0.02 * noise(frame, 0, seed + 10),
      bands: Array.from({ length: 12 }, (_, channel) => quiet ? -100
        : -60 + 40 * noise(songFrame >= 0 ? songFrame : frame, channel + 1, songFrame >= 0 ? seed : seed + 10)),
    };
  });
}

test('a silence pause in only the earlier clip falls back to matching shared music', () => {
  const match = matchAudioFrames(clip(1.6, true), clip(0.6, false));
  assert.equal(match.method, 'cross-correlation');
  assert.ok(Math.abs((match.newerSeconds - match.earlierSeconds) + 1) <= 0.051);
  assert.ok(match.audioSimilarity >= 0.72);
  assert.ok(match.confidenceMargin >= 0.06);
});

test('a silence pause in only the newer clip can also match shared music', () => {
  const match = matchAudioFrames(clip(0.6, false), clip(1.6, true));
  assert.equal(match.method, 'cross-correlation');
  assert.ok(Math.abs((match.newerSeconds - match.earlierSeconds) - 1) <= 0.051);
});

test('one pause does not bypass confidence checks when the audio differs', () => {
  assert.throws(() => matchAudioFrames(clip(1.6, true), clip(0.6, false, 99)), /No confident|ambiguous/);
});

test('two detectable silence pauses preserve the existing onset method', () => {
  const match = matchAudioFrames(clip(1.6, true), clip(2.6, true));
  assert.equal(match.method, 'silence-pause');
  assert.ok(Math.abs(match.earlierSeconds - 1.6) <= 0.051);
  assert.ok(Math.abs(match.newerSeconds - 2.6) <= 0.051);
});
