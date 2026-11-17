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
  const { listLibraryVideos, findLibraryVideo, savePersonalVideo } = await import('../app/lib/video-library-store.ts');
  const schema = `video_library_test_${randomUUID().replaceAll('-', '')}`;
  // A single checked-out connection is used for setup and store calls so the
  // search path cannot leak to the real application schema.
  const pool = getPostgresPool();
  const client = await pool.connect();
  const originalQuery = pool.query;
  pool.query = client.query.bind(client);
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
  } finally {
    pool.query = originalQuery;
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});
