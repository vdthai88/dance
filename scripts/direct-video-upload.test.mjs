import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
    const url = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(url)) return next(url.href, context);
  }
  return next(specifier, context);
}});

const { uploadVideo } = await import('../app/lib/upload-video-client.ts');
const { directUploadFromToken } = await import('../app/lib/direct-video-storage.ts');
const { VIDEO_PART_BYTES } = await import('../app/lib/video-upload-limits.ts');

test('an interrupted upload resumes from stored parts and submits only the token to the app', async (t) => {
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key),
  } });
  t.after(() => {
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else delete globalThis.localStorage;
  });
  const file = new File([new Uint8Array(VIDEO_PART_BYTES + 5)], 'dance.mov', { type: 'video/quicktime' });
  let started = 0;
  let alreadyUploaded = false;
  let failLastPart = true;
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    if (url === 'https://r2.test/part1') {
      assert.equal(request.body.size, VIDEO_PART_BYTES);
      assert.equal(alreadyUploaded, false);
      alreadyUploaded = true;
      return new Response(null);
    }
    if (url === 'https://r2.test/part2') {
      assert.equal(request.body.size, 5);
      return new Response(null, { status: failLastPart ? 403 : 200 });
    }
    const body = JSON.parse(request.body);
    if (url === '/api/replai-videos') {
      assert.deepEqual(body, { earlierVideoId: 'baseline', uploadToken: 'upload-token' });
      return Response.json({ id: 'saved' });
    }
    assert.equal(url, '/api/video-uploads');
    if (body.action === 'start') {
      started++;
      return Response.json({ direct: true, token: 'upload-token' });
    }
    assert.equal(body.token, 'upload-token');
    if (body.action === 'parts') return Response.json({ complete: false, parts: [
      { number: 1, size: VIDEO_PART_BYTES, url: alreadyUploaded ? undefined : 'https://r2.test/part1' },
      { number: 2, size: 5, url: 'https://r2.test/part2' },
    ] });
    return Response.json({ complete: true });
  });
  const options = { fields: { earlierVideoId: 'baseline' } };
  await assert.rejects(uploadVideo('/api/replai-videos', file, options), /same file again to resume/);
  failLastPart = false;
  const result = await uploadVideo('/api/replai-videos', file, options);
  assert.equal(started, 1);
  assert.deepEqual(await result.json(), { id: 'saved' });
  assert.equal(entries.size, 0);
});

test('a signed upload token is restricted to its account and expiration', (t) => {
  const previousSecret = process.env.R2_SECRET_ACCESS_KEY;
  process.env.R2_SECRET_ACCESS_KEY = 'test-only-secret';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.R2_SECRET_ACCESS_KEY;
    else process.env.R2_SECRET_ACCESS_KEY = previousSecret;
  });
  function sign(expires) {
    const payload = Buffer.from(JSON.stringify({ userId: 'owner', expires })).toString('base64url');
    const mac = createHmac('sha256', 'test-only-secret').update('direct-video-upload:').update(payload).digest('base64url');
    return payload + '.' + mac;
  }
  const token = sign(Date.now() + 60000);
  assert.equal(directUploadFromToken(token, 'owner').userId, 'owner');
  assert.throws(() => directUploadFromToken(token, 'other'), { status: 403 });
  assert.throws(() => directUploadFromToken('x' + token, 'owner'), { status: 400 });
  assert.throws(() => directUploadFromToken(sign(Date.now() - 1), 'owner'), { status: 410 });
});
