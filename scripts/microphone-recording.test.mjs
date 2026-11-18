import { test } from 'node:test';
import assert from 'node:assert/strict';
import { microphoneRecordingError } from '../app/lib/microphone-recording.ts';

test('HTTP LAN access explains the HTTPS requirement rather than blaming Safari support', () => {
  const error = microphoneRecordingError({ secureContext: false, microphoneAvailable: false, recorderAvailable: true });
  assert.match(error, /requires HTTPS/);
  assert.doesNotMatch(error, /does not support|Try Chrome or Edge/);
});
test('Safari recording capabilities are accepted on a secure page', () => {
  assert.equal(microphoneRecordingError({ secureContext: true, microphoneAvailable: true, recorderAvailable: true }), null);
});
test('missing microphone access and missing recorder are separate conditions', () => {
  assert.match(microphoneRecordingError({ secureContext: true, microphoneAvailable: false, recorderAvailable: true }), /Microphone access is unavailable/);
  assert.match(microphoneRecordingError({ secureContext: true, microphoneAvailable: true, recorderAvailable: false }), /Audio recording is unavailable/);
});
