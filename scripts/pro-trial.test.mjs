import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
  }
  return nextResolve(specifier, context);
} });

test('Pro enrollment grants teacher access atomically and preserves trial and role dates', { skip: !process.env.DATABASE_URL }, async () => {
  const { getPostgresPool } = await import('../db/postgres.ts');
  const { getPgProTrial, startPgProTrial } = await import('../app/lib/postgres-pro-trial-store.ts');
  const schema = 'pro_trial_test_' + randomUUID().replaceAll('-', '');
  const pool = getPostgresPool();
  const client = await pool.connect();
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = client.query.bind(client);
  pool.connect = async () => ({ query: client.query.bind(client), release() {} });
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const filename of (await readdir('db/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
      await client.query(await readFile(join('db/migrations', filename), 'utf8'));
    }
    for (const id of ['student', 'existing-teacher', 'blocked']) {
      await client.query('INSERT INTO "user" (id, name, email) VALUES ($1, $1, $2)', [id, id + '@example.test']);
    }
    await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ('student', 'student')");
    assert.equal(await getPgProTrial('student'), null);
    const started = await startPgProTrial('student', 14);
    assert.equal(started.alreadyStarted, false);
    assert.ok(started.trial.teacherRoleAddedAt);
    assert.equal(Date.parse(started.trial.endsAt) - Date.parse(started.trial.startedAt), 14 * 86400000);
    assert.deepEqual((await client.query("SELECT role_id FROM user_roles WHERE user_id='student' ORDER BY role_id")).rows.map((row) => row.role_id), ['student', 'teacher']);
    const repeated = await startPgProTrial('student', 30);
    assert.equal(repeated.alreadyStarted, true);
    assert.deepEqual(repeated.trial, started.trial);
    assert.deepEqual(await getPgProTrial('student'), started.trial);
    await client.query("DELETE FROM user_roles WHERE user_id='student' AND role_id='teacher'");
    const readded = await startPgProTrial('student', 30);
    assert.equal(readded.trial.startedAt, started.trial.startedAt);
    assert.equal(readded.trial.endsAt, started.trial.endsAt);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM user_pro_trials WHERE user_id='student'")).rows[0].count, 1);
    await client.query("INSERT INTO user_roles (user_id, role_id, created_at) VALUES ('existing-teacher', 'teacher', '2020-01-01T00:00:00Z')");
    const existing = await startPgProTrial('existing-teacher');
    assert.equal(existing.trial.teacherRoleAddedAt, '2020-01-01T00:00:00.000Z');
    assert.equal(existing.trial.endsAt, null, 'Duration may remain unset until configured');
    await client.query("UPDATE user_pro_trials SET started_at='2020-01-01T00:00:00Z', ends_at='2020-01-15T00:00:00Z' WHERE user_id='student'");
    const expired = await startPgProTrial('student', 30);
    assert.equal(expired.trial.endsAt, '2020-01-15T00:00:00.000Z', 'Expired trials cannot be restarted by clicking again');
    await client.query("ALTER TABLE user_pro_trials ADD CONSTRAINT reject_test_account CHECK(user_id <> 'blocked')");
    await assert.rejects(startPgProTrial('blocked', 14));
    assert.equal((await client.query("SELECT 1 FROM user_roles WHERE user_id='blocked'")).rowCount, 0, 'Trial failure must roll back the teacher role');
    assert.equal(await getPgProTrial('blocked'), null);
    await assert.rejects(startPgProTrial('unknown', 14), /Account not found/);
    for (const days of [0, -1, 1.5, NaN, 366]) await assert.rejects(startPgProTrial('student', days), /duration/);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});
