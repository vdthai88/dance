import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
  }
  return nextResolve(specifier, context);
} });

test('roster enrollment requires the invited identity and consent for existing accounts', { skip: !process.env.DATABASE_URL }, async () => {
  const { getPostgresPool } = await import('../db/postgres.ts');
  const { createRosterInvite, decideRosterInvite, listReceivedRosterInvites, listSentRosterInvites } =
    await import('../app/lib/postgres-roster-invite-store.ts');
  const pool = getPostgresPool();
  const client = await pool.connect();
  const schema = `roster_test_${randomUUID().replaceAll('-', '')}`;
  pool.query = client.query.bind(client);
  pool.connect = async () => ({ query: client.query.bind(client), release() {} });

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const file of (await readdir('db/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
      await client.query(await readFile(`db/migrations/${file}`, 'utf8'));
    }
    await client.query(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES
      ('teacher', 'Dance Teacher', 'teacher@example.test', true),
      ('student', 'Existing Student', 'student@example.test', true)`);
    await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ('teacher', 'teacher')");
    await client.query("INSERT INTO organizations (id, display_name, organization_type) VALUES ('a', 'Studio A', 'studio'), ('b', 'Studio B', 'studio')");
    await client.query("INSERT INTO company_memberships (company_id, user_id, role) VALUES ('a', 'teacher', 'teacher')");
    assert.equal((await createRosterInvite('teacher', 'b', 'student@example.test')).status, 'forbidden');

    const existing = await createRosterInvite('teacher', 'a', 'student@example.test');
    assert.equal(existing.status, 'created');
    assert.equal((await createRosterInvite('teacher', 'a', 'student@example.test')).status, 'already-sent');
    assert.equal((await listReceivedRosterInvites({ id: 'student', email: 'student@example.test' }))[0].id, existing.id);
    assert.equal(await decideRosterInvite('teacher', { token: existing.token }, true, false), 'email-mismatch');
    assert.equal(await decideRosterInvite('student', { token: existing.token }, true, true), 'consent-required');
    assert.equal(await decideRosterInvite('student', { id: existing.id }, true, false), 'accepted');

    const incoming = await createRosterInvite('teacher', 'a', 'new@example.test');
    assert.equal(incoming.status, 'created');
    await client.query(`INSERT INTO "user" (id, name, email) VALUES ('new', 'New Student', 'new@example.test')`);
    assert.equal(await decideRosterInvite('new', { token: incoming.token }, true, true), 'verification-required');
    await client.query(`UPDATE "user" SET "emailVerified" = true WHERE id = 'new'`);
    assert.equal(await decideRosterInvite('new', { token: incoming.token }, true, true), 'accepted');
    assert.equal(await decideRosterInvite('new', { token: incoming.token }, true, true), 'accepted');
    const accepted = await client.query(`SELECT s.user_id, c.company_id, t.teacher_user_id
      FROM students s JOIN student_company_assignments c ON c.student_id = s.id
      JOIN student_teacher_assignments t ON t.student_id = s.id ORDER BY s.user_id`);
    assert.deepEqual(accepted.rows, [
      { user_id: 'new', company_id: 'a', teacher_user_id: 'teacher' },
      { user_id: 'student', company_id: 'a', teacher_user_id: 'teacher' },
    ]);
    assert.deepEqual((await listSentRosterInvites('teacher')).map(({ status }) => status), ['accepted', 'accepted']);
  } finally {
    try {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      client.release();
      await pool.end();
    }
  }
});
