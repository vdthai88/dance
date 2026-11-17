import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run against PostgreSQL with the app's environment loaded. Only a new, temporary
// schema is touched; it is removed after the assertions, including on failure.
registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
  }
  return nextResolve(specifier, context);
} });

test('personal and session video listing enforces account ownership and deduplicates personal uploads', { skip: !process.env.DATABASE_URL }, async () => {
  const { getPostgresPool } = await import('../db/postgres.ts');
  const { listLibraryVideos, findLibraryVideo, savePersonalVideo, deleteLibraryVideo } = await import('../app/lib/video-library-store.ts');
  const { findPgCritique, findPgCritiqueForVideo, savePgCritique } = await import('../app/lib/postgres-critique-store.ts');
  const schema = `video_library_test_${randomUUID().replaceAll('-', '')}`;
  // A single checked-out connection is used for setup and store calls so the
  // search path cannot leak to the real application schema.
  const pool = getPostgresPool();
  const client = await pool.connect();
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = client.query.bind(client);
  pool.connect = async () => ({ query: client.query.bind(client), release() {} });
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const filename of (await readdir('db/migrations')).filter((file) => file.endsWith('.sql')).sort()) {
      await client.query(await readFile(join('db/migrations', filename), 'utf8'));
    }
    for (const id of ['student-a', 'student-b', 'teacher']) {
      await client.query('INSERT INTO "user" (id, name, email) VALUES ($1, $1, $2)', [id, `${id}@example.test`]);
    }
    await client.query("INSERT INTO students (id, user_id, display_name) VALUES ('a', 'student-a', 'A'), ('b', 'student-b', 'B')");
    await client.query("INSERT INTO practice_sessions (id, student_id, session_name, session_date) VALUES ('session-a', 'a', 'Session A', current_date), ('session-b', 'b', 'Session B', current_date)");
    await client.query(`INSERT INTO videos (id, session_id, uploaded_by_user_id, object_key, original_filename, sha256)
      VALUES ('teacher-video-a', 'session-a', 'teacher', 'teacher-a.mp4', 'teacher-a.mp4', 'teacher-a'),
        ('teacher-video-b', 'session-b', 'teacher', 'teacher-b.mp4', 'teacher-b.mp4', 'teacher-b')`);
    const input = { userId: 'student-a', filename: 'practice.mp4', contentType: 'video/mp4', byteSize: 100, hash: 'personal-a', objectKey: 'personal-a.mp4' };
    const saved = await savePersonalVideo(input);
    assert.equal((await savePersonalVideo({ ...input, filename: 'renamed.mp4' })).id, saved.id);
    assert.deepEqual(new Set((await listLibraryVideos('student-a')).map((item) => item.id)), new Set([saved.id, 'teacher-video-a']));
    assert.deepEqual((await listLibraryVideos('student-b')).map((item) => item.id), ['teacher-video-b']);
    assert.deepEqual(await listLibraryVideos('teacher'), []);
    assert.equal(await findLibraryVideo('student-b', saved.id), null);
    assert.equal(await findLibraryVideo('student-a', 'teacher-video-b'), null);
    assert.equal((await findLibraryVideo('student-a', 'teacher-video-a')).video.sessionName, 'Session A');
    assert.equal((await findLibraryVideo('student-a', saved.id)).video.filename, 'renamed.mp4');
    assert.equal((await findLibraryVideo('student-a', saved.id)).video.canDelete, true);
    assert.equal((await findLibraryVideo('student-a', 'teacher-video-a')).video.canDelete, false);

    const removedKeys = [];
    const removeObject = async (key) => { removedKeys.push(key); };
    assert.equal(await deleteLibraryVideo('student-b', saved.id, removeObject), 'not-found');
    assert.equal(await deleteLibraryVideo('student-a', 'teacher-video-a', removeObject), 'forbidden');
    assert.deepEqual(removedKeys, []);
    await assert.rejects(deleteLibraryVideo('student-a', saved.id, async () => { throw new Error('Storage unavailable'); }), /Storage unavailable/);
    assert.equal((await findLibraryVideo('student-a', saved.id)).video.available, true);
    assert.equal(await deleteLibraryVideo('student-a', saved.id, removeObject), 'deleted');
    assert.deepEqual(removedKeys, ['personal-a.mp4']);
    assert.equal(await findLibraryVideo('student-a', saved.id), null);
    assert.equal(await deleteLibraryVideo('student-a', saved.id, removeObject), 'not-found');
    assert.equal((await client.query('SELECT object_key, storage_status FROM videos WHERE id=$1', [saved.id])).rows[0].storage_status, 'deleted');
    assert.equal((await savePersonalVideo(input)).id, saved.id);
    assert.equal((await findLibraryVideo('student-a', saved.id)).video.available, true);

    await client.query(`INSERT INTO videos (id, session_id, uploaded_by_user_id, object_key, original_filename, sha256)
      VALUES ('own-session-video', 'session-a', 'student-a', 'own-session.mp4', 'own-session.mp4', 'own-session')`);
    assert.equal(await deleteLibraryVideo('student-a', 'own-session-video', removeObject), 'deleted');
    assert.equal(await findLibraryVideo('student-a', 'own-session-video'), null);

    // Video-only deletion retains the cached feedback, including after reupload.
    const feedback = { summary: 'Practice your balance.', observations: [], limitations: [] };
    const baseline = { key: 'baseline-a', earlierHash: input.hash, newerHash: null, earlierFilename: input.filename, newerFilename: null, model: 'test', critique: feedback };
    const comparison = { ...baseline, key: 'comparison-a', earlierHash: 'another-take', newerHash: input.hash };
    await savePgCritique(baseline, 'student-a');
    await savePgCritique(comparison, 'student-a');
    await savePgCritique({ ...baseline, key: 'unrelated', earlierHash: 'unrelated-video' }, 'student-a');
    await client.query("INSERT INTO session_critiques (session_id, cache_key) VALUES ('session-a', 'baseline-a'), ('session-b', 'baseline-a')");
    assert.equal(await deleteLibraryVideo('student-a', saved.id, removeObject, false), 'deleted');
    assert.ok(await findPgCritiqueForVideo(input.hash, 'student-a'));
    await savePersonalVideo(input);

    // A storage failure rolls back both choices' database effects.
    await assert.rejects(deleteLibraryVideo('student-a', saved.id, async () => { throw new Error('Storage unavailable'); }, true), /Storage unavailable/);
    assert.ok(await findPgCritique('baseline-a', 'student-a'));
    assert.equal((await client.query("SELECT 1 FROM session_critiques WHERE session_id='session-a'")).rowCount, 1);
    assert.equal(await deleteLibraryVideo('student-a', saved.id, removeObject, true), 'deleted');
    assert.equal(await findPgCritique('baseline-a', 'student-a'), null);
    assert.equal(await findPgCritique('comparison-a', 'student-a'), null);
    assert.equal(await findPgCritiqueForVideo(input.hash, 'student-a'), null);
    assert.ok(await findPgCritique('unrelated', 'student-a'));
    assert.ok(await findPgCritique('baseline-a', 'student-b'));
    assert.ok(await findPgCritique('comparison-a', 'student-b'));
    assert.equal((await client.query("SELECT 1 FROM session_critiques WHERE session_id='session-a'")).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM session_critiques WHERE session_id='session-b'")).rowCount, 1);
    await savePersonalVideo(input);
    assert.equal(await findPgCritiqueForVideo(input.hash, 'student-a'), null);
    // Someone else's regeneration does not restore this user's deleted result.
    await savePgCritique(baseline, 'student-b');
    assert.equal(await findPgCritique('baseline-a', 'student-a'), null);
    await savePgCritique(baseline, 'student-a');
    assert.ok(await findPgCritique('baseline-a', 'student-a'));
    assert.equal(await findPgCritique('comparison-a', 'student-a'), null);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});
