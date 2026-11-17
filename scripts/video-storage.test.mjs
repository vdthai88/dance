import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveLocalVideo, streamLocalVideo, VideoRangeError } from '../app/lib/video-storage.ts';

test('stores a file and streams full, partial and suffix playback without buffering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'one-dance-storage-test-'));
  const originalDriver = process.env.VIDEO_STORAGE_DRIVER;
  const originalRoot = process.env.LOCAL_UPLOAD_DIR;
  process.env.VIDEO_STORAGE_DRIVER = 'local';
  process.env.LOCAL_UPLOAD_DIR = join(root, 'uploads');
  try {
    const filePath = join(root, 'input');
    await writeFile(filePath, '0123456789');
    const key = await saveLocalVideo({ companyId: null, studentId: 'student', sessionId: 'session', hash: 'a'.repeat(64), filename: 'take.mp4', filePath, byteSize: 10 });
    const full = await streamLocalVideo(key);
    assert.equal(full.status, 200);
    assert.equal(await new Response(full.body).text(), '0123456789');
    const partial = await streamLocalVideo(key, 'bytes=2-5');
    assert.equal(partial.status, 206);
    assert.equal(partial.headers['Content-Range'], 'bytes 2-5/10');
    assert.equal(await new Response(partial.body).text(), '2345');
    const suffix = await streamLocalVideo(key, 'bytes=-3');
    assert.equal(await new Response(suffix.body).text(), '789');
    await assert.rejects(streamLocalVideo(key, 'bytes=10-'), VideoRangeError);
    await assert.rejects(streamLocalVideo(key, 'bytes=4-2'), VideoRangeError);
    await assert.rejects(streamLocalVideo(key, 'bytes=0-1,4-5'), VideoRangeError);
    await assert.rejects(streamLocalVideo('../outside'), /Invalid local video object key/);
  } finally {
    if (originalDriver === undefined) delete process.env.VIDEO_STORAGE_DRIVER; else process.env.VIDEO_STORAGE_DRIVER = originalDriver;
    if (originalRoot === undefined) delete process.env.LOCAL_UPLOAD_DIR; else process.env.LOCAL_UPLOAD_DIR = originalRoot;
    await rm(root, { recursive: true, force: true });
  }
});
