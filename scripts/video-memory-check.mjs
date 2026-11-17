// Generate two 120 MiB takes without allocating their complete contents.
// Run: node --max-old-space-size=128 scripts/video-memory-check.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { readVideoUpload } from '../app/lib/video-upload.ts';
import { saveLocalVideo, streamLocalVideo } from '../app/lib/video-storage.ts';

const root = await mkdtemp(join(tmpdir(), 'one-dance-memory-check-'));
process.env.VIDEO_STORAGE_DRIVER = 'local';
process.env.LOCAL_UPLOAD_DIR = join(root, 'saved');
const chunk = Buffer.alloc(64 * 1024, 42);
const chunksPerTake = 1920;
const expectedSize = chunk.length * chunksPerTake;
const hash = createHash('sha256');
for (let index = 0; index < chunksPerTake; index++) hash.update(chunk);
const expectedHash = hash.digest('hex');
let received = 0;
const server = createServer(async (request, response) => {
  const hash = createHash('sha256');
  let size = 0;
  for await (const bytes of request) { size += bytes.length; hash.update(bytes); }
  received += size;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ size, sha256: hash.digest('hex') }));
});
let form;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const boundary = 'one-dance-memory-check';
  const request = new Request('http://localhost/upload', {
    method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, duplex: 'half',
    body: Readable.toWeb(Readable.from((async function* () {
      for (const field of ['video', 'comparisonVideo']) {
        yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${field}.mp4"\r\nContent-Type: video/mp4\r\n\r\n`);
        for (let index = 0; index < chunksPerTake; index++) yield chunk;
        yield Buffer.from('\r\n');
      }
      yield Buffer.from(`--${boundary}--\r\n`);
    })())),
  });
  form = await readVideoUpload(request);
  for (const field of ['video', 'comparisonVideo']) {
    const video = form.get(field);
    assert.equal(video.size, expectedSize);
    assert.equal(video.sha256, expectedHash);
    const key = await saveLocalVideo({ companyId: null, studentId: 'test', sessionId: field, hash: video.sha256, filename: video.name, filePath: video.path, byteSize: video.size });
    const stored = await streamLocalVideo(key);
    let playbackBytes = 0;
    for await (const bytes of stored.body) playbackBytes += bytes.length;
    assert.equal(playbackBytes, expectedSize);
    const result = await fetch(`http://127.0.0.1:${server.address().port}/upload`, {
      method: 'POST', body: video.stream(), duplex: 'half', headers: { 'Content-Length': String(video.size) },
    });
    assert.deepEqual(await result.json(), { size: expectedSize, sha256: expectedHash });
  }
  assert.equal(received, 240 * 1024 * 1024);
  const peakMiB = process.resourceUsage().maxRSS / 1024;
  console.log(`240 MiB streamed through parsing, hashing, storage, playback and HTTP upload. Peak process memory: ${peakMiB.toFixed(1)} MiB.`);
  assert.ok(peakMiB < 300, 'Streaming test unexpectedly exceeded 300 MiB RSS.');
} finally {
  await form?.cleanup();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
