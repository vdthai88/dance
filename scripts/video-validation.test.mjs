import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks, createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ts from 'typescript';

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
  }
  return nextResolve(specifier, context);
} });
const { validateUploadedVideo } = await import('../app/lib/video-validation.ts');
const { checkVideoPlayback } = await import('../app/lib/video-playback-check.ts');
const uploadModule = await import('../app/lib/video-upload.ts');

test('both upload APIs reject before storage or database saves and clean temporary files', async () => {
  for (const [route, prefix] of [
    ['../app/api/replai-videos/route.ts', '../../lib/'],
    ['../app/api/sessions/[sessionId]/videos/route.ts', '../../../../lib/'],
  ]) {
    let writes = 0;
    let cleanups = 0;
    const file = { path: 'temporary', sha256: 'test-hash', name: 'bad.mp4', size: 10, type: 'video/mp4' };
    const dependencies = {
      [prefix + 'auth-session']: { getAuthenticatedUser: async () => ({ id: 'user' }) },
      [prefix + 'database-driver']: { usesPostgres: () => true },
      [prefix + 'video-upload']: { ...uploadModule, readVideoUpload: async () => ({ get: (name) => name === 'video' ? file : null, cleanup: async () => { cleanups++; } }) },
      [prefix + 'video-validation']: { validateUploadedVideo: async () => { throw new uploadModule.VideoUploadError('Damaged video; not saved.', 422); } },
      [prefix + 'video-storage']: { saveLocalVideo: async () => { writes++; }, deleteLocalVideo: async () => {} },
      [prefix + 'video-library-store']: { findDuplicatePersonalVideo: async () => null, savePersonalVideo: async () => { writes++; } },
      [prefix + 'postgres-session-store']: { pgCanAccessSession: async () => true, getPgSessionVideoStorageContext: async () => ({}), savePgSessionVideo: async () => { writes++; } },
      [prefix + 'session-store']: {},
    };
    const path = fileURLToPath(new URL(route, import.meta.url));
    const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const compiled = { exports: {} };
    const localRequire = createRequire(path);
    new Function('require', 'module', 'exports', outputText)((name) => dependencies[name] ?? localRequire(name), compiled, compiled.exports);
    const response = await compiled.exports.POST(new Request('http://localhost/upload', { method: 'POST' }), { params: Promise.resolve({ sessionId: 'session' }) });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /not saved/);
    assert.equal(writes, 0);
    assert.equal(cleanups, 1);
  }
});

test('fully decodes good video, rejects corrupt/truncated and audio-only uploads without changing source files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'one-dance-validation-test-'));
  const good = join(dir, 'good.mp4');
  try {
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', '-movflags', '+faststart', good], { windowsHide: true });
    const original = await readFile(good);
    await validateUploadedVideo({ path: good });
    assert.deepEqual(await readFile(good), original);
    const corrupt = join(dir, 'corrupt.mp4');
    await writeFile(corrupt, 'not actually a video');
    const truncated = join(dir, 'truncated.mp4');
    await writeFile(truncated, original.subarray(0, Math.floor(original.length * 0.65)));
    const audio = join(dir, 'audio.mp4');
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-c:a', 'aac', audio], { windowsHide: true });
    for (const path of [corrupt, truncated, audio]) {
      await assert.rejects(validateUploadedVideo({ path }), (error) => error.status === 422 && /not been saved/.test(error.message));
      await access(path); // Caller owns temporary-file cleanup; validator never modifies the input.
    }
    const silent = join(dir, 'silent.webm');
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=10:duration=0.3', '-c:v', 'libvpx-vp9', '-threads', '1', silent], { windowsHide: true });
    await validateUploadedVideo({ path: silent });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('browser preflight rejects decode and seek failures, accepts playable clips, and releases object URLs', async () => {
  const oldDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  let mode = 'ok';
  URL.createObjectURL = () => 'blob:local-test';
  URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.document = { createElement() {
    let src = '';
    return { duration: 10, videoWidth: 160, videoHeight: 120, readyState: 2,
      set src(value) { src = value; },
      set currentTime(_value) { queueMicrotask(() => mode === 'seek-error' ? this.onerror?.() : this.onseeked?.()); },
      removeAttribute() { src = ''; },
      load() { if (src) queueMicrotask(() => mode === 'decode-error' ? this.onerror?.() : this.onloadeddata?.()); },
    };
  } };
  try {
    await checkVideoPlayback(new File(['video'], 'ok.mp4'));
    for (const failure of ['decode-error', 'seek-error']) {
      mode = failure;
      await assert.rejects(checkVideoPlayback(new File(['bad'], 'bad.mp4')), /not been saved/);
    }
    assert.equal(revoked.length, 3);
  } finally { globalThis.document = oldDocument; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});
