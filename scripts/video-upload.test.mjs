import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { registerHooks } from 'node:module';

const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === './video-upload-limits' ? new URL('./video-upload-limits.ts', context.parentURL).href : specifier, context);
}});
const { isUploadedVideo, readVideoUpload, VideoUploadError } = await import('../app/lib/video-upload.ts');
hook.deregister();

function requestFor(parts, ending = true) {
  const boundary = 'one-dance-test-boundary';
  const body = Readable.toWeb(Readable.from((async function* () {
    for (const part of parts) {
      yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.field}"${part.filename ? `; filename="${part.filename}"` : ''}\r\n${part.filename ? 'Content-Type: video/mp4\r\n' : ''}\r\n`);
      yield Buffer.from(part.value);
      yield Buffer.from('\r\n');
    }
    if (ending) yield Buffer.from(`--${boundary}--\r\n`);
  })()));
  return new Request('http://localhost/upload', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body, duplex: 'half' });
}

test('streams both takes, preserves metadata and exact hashes, and removes temporary files', async () => {
  const form = await readVideoUpload(requestFor([
    { field: 'video', filename: 'éarlier.mp4', value: 'first take' },
    { field: 'sessionId', value: 'session-123' },
    { field: 'comparisonVideo', filename: 'newer.mp4', value: 'second take' },
  ]));
  const first = form.get('video');
  const second = form.get('comparisonVideo');
  try {
    assert.ok(isUploadedVideo(first));
    assert.ok(isUploadedVideo(second));
    assert.equal(first.name, 'éarlier.mp4');
    assert.equal(first.type, 'video/mp4');
    assert.equal(first.size, 10);
    assert.equal(first.sha256, createHash('sha256').update('first take').digest('hex'));
    assert.equal(await readFile(first.path, 'utf8'), 'first take');
    assert.equal(await new Response(second.stream()).text(), 'second take');
    assert.equal(form.get('sessionId'), 'session-123');
  } finally { await form.cleanup(); }
  await assert.rejects(access(first.path));
  await assert.rejects(access(second.path));
});

test('enforces the combined size limit and cleans up rejected uploads', async () => {
  const before = (await readdir(tmpdir())).filter((name) => name.startsWith('one-dance-upload-')).sort();
  await assert.rejects(readVideoUpload(requestFor([
    { field: 'video', filename: 'a.mp4', value: '123456' },
    { field: 'comparisonVideo', filename: 'b.mp4', value: '123456' },
  ]), ['video', 'comparisonVideo'], 10), (error) => error instanceof VideoUploadError && error.status === 413);
  const after = (await readdir(tmpdir())).filter((name) => name.startsWith('one-dance-upload-')).sort();
  assert.deepEqual(after, before);
});

test('accepts exactly the size limit', async () => {
  const form = await readVideoUpload(requestFor([{ field: 'video', filename: 'a.mp4', value: '1234567890' }]), ['video'], 10);
  try { assert.equal(form.get('video').size, 10); } finally { await form.cleanup(); }
});

test('rejects duplicate videos and unexpected file fields', async () => {
  for (const parts of [
    [{ field: 'video', filename: 'a.mp4', value: 'a' }, { field: 'video', filename: 'b.mp4', value: 'b' }],
    [{ field: 'unknown', filename: 'a.mp4', value: 'a' }],
  ]) {
    await assert.rejects(readVideoUpload(requestFor(parts)), VideoUploadError);
  }
});

test('cleans up an incomplete upload', async () => {
  const before = (await readdir(tmpdir())).filter((name) => name.startsWith('one-dance-upload-')).sort();
  await assert.rejects(readVideoUpload(requestFor([{ field: 'video', filename: 'a.mp4', value: 'incomplete' }], false)), VideoUploadError);
  assert.deepEqual((await readdir(tmpdir())).filter((name) => name.startsWith('one-dance-upload-')).sort(), before);
});

test('rejects an oversized text field', async () => {
  await assert.rejects(readVideoUpload(requestFor([{ field: 'sessionId', value: 'x'.repeat(4097) }])), VideoUploadError);
});
