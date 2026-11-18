import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCritiqueKey } from '../app/lib/critique-key.ts';
import { tmpdir } from 'node:os';

// Run against PostgreSQL with the app's environment loaded. Only a new, temporary
// schema is touched; it is removed after the assertions, including on failure.
registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
  }
  return nextResolve(specifier, context);
} });

test('critique keys include account identity and both video fingerprints', () => {
  assert.equal(makeCritiqueKey('video', null, 'a'), makeCritiqueKey('video', null, 'a'));
  assert.notEqual(makeCritiqueKey('video', null, 'a'), makeCritiqueKey('video', null, 'b'));
  assert.notEqual(makeCritiqueKey('video', 'newer', 'a'), makeCritiqueKey('video', 'newer', 'b'));
  assert.notEqual(makeCritiqueKey('video', 'newer', 'a'), makeCritiqueKey('newer', 'video', 'a'));
  assert.throws(() => makeCritiqueKey('video', null, ''), /signed-in account/);
});

test('legacy SQLite fallback also isolates critiques by account', async () => {
  const root = await mkdtemp(join(tmpdir(), 'one-critique-owner-test-'));
  const previousPath = process.env.DANCE_DATABASE_PATH;
  process.env.DANCE_DATABASE_PATH = join(root, 'test.sqlite');
  try {
    const { findCritique, findCritiqueForVideo, saveCritique, openDanceDatabase } = await import('../app/lib/critique-store.ts');
    const critique = { summary: 'Account A feedback.', observations: [], limitations: [] };
    const a = { key: makeCritiqueKey('same-video', null, 'a'), earlierHash: 'same-video', newerHash: null, earlierFilename: 'a.mp4', newerFilename: null, model: 'test', critique };
    const db = openDanceDatabase();
    try {
      db.prepare('INSERT INTO critiques (cache_key, earlier_sha256, model, critique_json) VALUES (?, ?, ?, ?)').run('legacy', 'same-video', 'test', JSON.stringify(critique));
    } finally { db.close(); }
    assert.equal(findCritiqueForVideo('same-video', 'b'), null);
    saveCritique(a, 'a');
    assert.equal(findCritiqueForVideo('same-video', 'b'), null);
    assert.equal(findCritique(a.key, 'b'), null);
    assert.throws(() => saveCritique(a, 'b'), /does not belong/);
    saveCritique({ ...a, key: makeCritiqueKey('same-video', null, 'b'), critique: { ...critique, summary: 'Account B feedback.' } }, 'b');
    assert.equal(findCritiqueForVideo('same-video', 'a').critique.summary, 'Account A feedback.');
    assert.equal(findCritiqueForVideo('same-video', 'b').critique.summary, 'Account B feedback.');
  } finally {
    if (previousPath === undefined) delete process.env.DANCE_DATABASE_PATH; else process.env.DANCE_DATABASE_PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});

test('personal and session video listing enforces account ownership and deduplicates personal uploads', { skip: !process.env.DATABASE_URL }, async () => {
  const { getPostgresPool } = await import('../db/postgres.ts');
  const { listLibraryVideos, findLibraryVideo, findDuplicatePersonalVideo, savePersonalVideo, deleteLibraryVideo, getLibraryVideoDetails, listVideoGroups, createVideoGroup, updateVideoGroup, moveLibraryVideo } = await import('../app/lib/video-library-store.ts');
  const { attachPgSessionCritique, findPgCritique, findPgCritiqueForVideo, savePgCritique } = await import('../app/lib/postgres-critique-store.ts');
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
    assert.equal(saved.alreadyExists, false);
    assert.ok(saved.groupId);
    assert.equal((await listVideoGroups('student-a')).find((group) => group.id === saved.groupId)?.name, input.filename);
    const repeat = await savePersonalVideo({ ...input, filename: 'renamed.mp4' });
    assert.equal(repeat.id, saved.id);
    assert.equal(repeat.alreadyExists, true, 'Renaming identical bytes still opens the existing video');
    assert.equal(repeat.createdAt, saved.createdAt, 'Duplicate detection preserves the original upload date');
    assert.equal(repeat.filename, input.filename, 'A duplicate does not rename the saved video');
    assert.equal(repeat.existingGroupName, input.filename);
    assert.equal((await findDuplicatePersonalVideo('student-a', input.hash)).id, saved.id);
    assert.equal(await findDuplicatePersonalVideo('student-b', input.hash), null);
    assert.equal((await findLibraryVideo('student-a', saved.id)).video.groupId, saved.groupId);
    await updateVideoGroup('student-a', saved.groupId, { name: 'My renamed group' });
    await savePersonalVideo(input);
    assert.equal((await listVideoGroups('student-a')).find((group) => group.id === saved.groupId)?.name, 'My renamed group');
    await savePersonalVideo({ ...input, filename: 'renamed.mp4' });
    assert.deepEqual(new Set((await listLibraryVideos('student-a')).map((item) => item.id)), new Set([saved.id, 'teacher-video-a']));
    assert.deepEqual((await listLibraryVideos('student-b')).map((item) => item.id), ['teacher-video-b']);
    assert.deepEqual(await listLibraryVideos('teacher'), []);
    assert.equal(await findLibraryVideo('student-b', saved.id), null);
    assert.equal(await findLibraryVideo('student-a', 'teacher-video-b'), null);
    assert.equal((await findLibraryVideo('student-a', 'teacher-video-a')).video.sessionName, 'Session A');
    assert.equal((await findLibraryVideo('student-a', saved.id)).video.filename, input.filename);
    assert.equal((await findLibraryVideo('student-a', saved.id)).video.canDelete, true);
    assert.equal((await findLibraryVideo('student-a', 'teacher-video-a')).video.canDelete, false);

    const removedKeys = [];
    const removeObject = async (key) => { removedKeys.push(key); };
    assert.equal(await deleteLibraryVideo('student-b', saved.id, removeObject), 'not-found');
    assert.equal(await deleteLibraryVideo('student-a', 'teacher-video-a', removeObject), 'forbidden');
    assert.deepEqual(removedKeys, []);
    await assert.rejects(deleteLibraryVideo('student-a', saved.id, async () => { throw new Error('Storage unavailable'); }), /Storage unavailable/);
    assert.equal((await findLibraryVideo('student-a', saved.id)).video.available, true);
    assert.ok((await listVideoGroups('student-a')).some((group) => group.id === saved.groupId), 'Failed storage deletion keeps the group');
    assert.equal(await deleteLibraryVideo('student-a', saved.id, removeObject), 'deleted');
    assert.ok(!(await listVideoGroups('student-a')).some((group) => group.id === saved.groupId), 'Deleting the last video removes its group');
    assert.deepEqual(removedKeys, ['personal-a.mp4']);
    assert.equal(await findLibraryVideo('student-a', saved.id), null);
    assert.equal(await findDuplicatePersonalVideo('student-a', input.hash), null);
    assert.equal(await deleteLibraryVideo('student-a', saved.id, removeObject), 'not-found');
    assert.equal((await client.query('SELECT object_key, storage_status FROM videos WHERE id=$1', [saved.id])).rows[0].storage_status, 'deleted');
    const restored = await savePersonalVideo(input);
    assert.equal(restored.id, saved.id);
    assert.equal(restored.alreadyExists, false, 'A deleted video can be restored and analysed again');
    assert.equal((await findLibraryVideo('student-a', saved.id)).video.available, true);

    await client.query(`INSERT INTO videos (id, session_id, uploaded_by_user_id, object_key, original_filename, sha256)
      VALUES ('own-session-video', 'session-a', 'student-a', 'own-session.mp4', 'own-session.mp4', 'own-session')`);
    assert.equal(await deleteLibraryVideo('student-a', 'own-session-video', removeObject), 'deleted');
    assert.equal(await findLibraryVideo('student-a', 'own-session-video'), null);

    // Video-only deletion retains the cached feedback, including after reupload.
    const feedback = { summary: 'Practice your balance.', observations: [], limitations: [] };
    const baseline = { key: makeCritiqueKey(input.hash, null, 'student-a'), earlierHash: input.hash, newerHash: null, earlierFilename: input.filename, newerFilename: null, model: 'test', critique: feedback };
    const comparison = { ...baseline, key: makeCritiqueKey('another-take', input.hash, 'student-a'), earlierHash: 'another-take', newerHash: input.hash };
    const unrelated = { ...baseline, key: makeCritiqueKey('unrelated-video', null, 'student-a'), earlierHash: 'unrelated-video' };
    const otherBaseline = { ...baseline, key: makeCritiqueKey(input.hash, null, 'student-b'), critique: { ...feedback, summary: 'Student B feedback.' } };
    const otherComparison = { ...comparison, key: makeCritiqueKey('another-take', input.hash, 'student-b') };
    // Unknown legacy owners are never inferred merely from an identical upload.
    await client.query(`INSERT INTO critiques (cache_key, earlier_sha256, earlier_filename, model, critique_json)
      VALUES ('legacy-shared', $1, 'old.mp4', 'test', $2::jsonb)`, [input.hash, JSON.stringify(feedback)]);
    assert.equal(await findPgCritiqueForVideo(input.hash, 'student-a'), null);
    assert.equal(await findPgCritique('legacy-shared', 'student-b'), null);
    await savePgCritique(baseline, 'student-a');
    await savePgCritique(comparison, 'student-a');
    await savePgCritique(unrelated, 'student-a');
    // Regression: a new account uploads exactly the same bytes and sees no feedback.
    const otherAccountUpload = await savePersonalVideo({ ...input, userId: 'student-b', objectKey: 'personal-b.mp4' });
    assert.equal(otherAccountUpload.alreadyExists, false, 'Another account does not count as a duplicate');
    assert.equal(await findPgCritiqueForVideo(input.hash, 'student-b'), null);
    assert.equal(await findPgCritique(baseline.key, 'student-b'), null);
    assert.equal(await findPgCritique(comparison.key, 'student-b'), null);
    await assert.rejects(savePgCritique(baseline, 'student-b'), /does not belong/);
    assert.equal(await attachPgSessionCritique('session-b', baseline.key, 'student-b'), false);
    await savePgCritique(otherBaseline, 'student-b');
    await savePgCritique(otherComparison, 'student-b');
    assert.equal((await findPgCritiqueForVideo(input.hash, 'student-a')).critique.summary, feedback.summary);
    assert.equal((await findPgCritiqueForVideo(input.hash, 'student-b')).critique.summary, 'Student B feedback.');
    assert.equal(await attachPgSessionCritique('session-a', baseline.key, 'student-a'), true);
    assert.equal(await attachPgSessionCritique('session-a', baseline.key, 'student-a'), true);
    assert.equal(await attachPgSessionCritique('session-b', otherBaseline.key, 'student-b'), true);
    assert.equal(await deleteLibraryVideo('student-a', saved.id, removeObject, false), 'deleted');
    assert.ok(await findPgCritiqueForVideo(input.hash, 'student-a'));
    await savePersonalVideo(input);

    // A storage failure rolls back both choices' database effects.
    await assert.rejects(deleteLibraryVideo('student-a', saved.id, async () => { throw new Error('Storage unavailable'); }, true), /Storage unavailable/);
    assert.ok(await findPgCritique(baseline.key, 'student-a'));
    assert.equal((await client.query("SELECT 1 FROM session_critiques WHERE session_id='session-a'")).rowCount, 1);
    assert.equal(await deleteLibraryVideo('student-a', saved.id, removeObject, true), 'deleted');
    assert.equal(await findPgCritique(baseline.key, 'student-a'), null);
    assert.equal(await findPgCritique(comparison.key, 'student-a'), null);
    // Groups are private to an account and their names/collapse state survive reloads.
    await savePersonalVideo(input);
    const existingGroupIds = (await listVideoGroups('student-a')).map((item) => item.id);
    const group = await createVideoGroup('student-a', 'Orange Coloured Sky');
    const otherGroup = await createVideoGroup('student-b', 'Private B group');
    assert.deepEqual(new Set((await listVideoGroups('student-a')).map((item) => item.id)), new Set([...existingGroupIds, group.id]));
    assert.equal(await updateVideoGroup('student-b', group.id, { name: 'Not allowed' }), null);
    assert.equal(await moveLibraryVideo('student-a', saved.id, otherGroup.id), false);
    assert.equal(await moveLibraryVideo('student-b', saved.id, otherGroup.id), false);
    assert.equal(await moveLibraryVideo('student-a', saved.id, group.id), true);
    assert.equal((await findLibraryVideo('student-a', saved.id)).video.groupId, group.id);
    await updateVideoGroup('student-a', group.id, { name: 'Competition practice', collapsed: true });
    assert.deepEqual((await listVideoGroups('student-a')).find((item) => item.id === group.id), { id: group.id, name: 'Competition practice', collapsed: true });
    assert.equal(await moveLibraryVideo('student-a', saved.id, null), true);
    assert.equal((await findLibraryVideo('student-a', saved.id)).video.groupId, null);

    // Each take has its own feedback; comparisons belong to the newer video only.
    const groupCount = (await listVideoGroups('student-a')).length;
    const newerInput = { ...input, hash: 'newer-hash', filename: 'newer.mp4', objectKey: 'newer-a.mp4', groupId: group.id };
    const newer = await savePersonalVideo(newerInput);
    assert.equal(newer.groupId, group.id);
    assert.equal((await listVideoGroups('student-a')).length, groupCount, 'A newer take must not create a filename group');
    assert.equal((await savePersonalVideo(newerInput)).groupId, group.id);
    assert.equal((await listVideoGroups('student-a')).length, groupCount);
    await assert.rejects(savePersonalVideo({ ...newerInput, hash: 'forbidden-group', groupId: otherGroup.id }), /group is unavailable/);
    assert.equal((await listLibraryVideos('student-a')).some((video) => video.filename === 'newer.mp4' && video.id !== newer.id), false);
    const progressCritique = { ...feedback, comparison: 'Progress and new feedback.', observations: Array.from({ length: 5 }, (_, index) => ({
      timestampSeconds: 37 + index, area: 'Balance', observation: 'Visible landing control.', suggestedAdjustment: 'Hold the landing.',
      exercise: 'Balance drill.', confidence: 'medium', video: 'new', progressStatus: index === 0 ? 'improved' : 'new',
      progressReason: 'The newer landing shows steadier alignment.', baselineObservationIndex: null,
    })) };
    const paired = { ...baseline, key: makeCritiqueKey(input.hash, 'newer-hash', 'student-a'), newerHash: 'newer-hash', newerFilename: 'newer.mp4', earlierSongStart: 5, newerSongStart: 15, critique: progressCritique };
    await savePgCritique(paired, 'student-a');
    const earlierDetails = await getLibraryVideoDetails('student-a', saved.id);
    assert.ok(!earlierDetails.reviews.some((item) => item.key === paired.key));
    const newerDetails = await getLibraryVideoDetails('student-a', newer.id);
    const newerReview = newerDetails.reviews.find((item) => item.key === paired.key);
    assert.equal((await findPgCritique(paired.key, 'student-a')).earlierSongStart, 5);
    assert.equal((await findPgCritique(paired.key, 'student-a')).newerSongStart, 15);
    assert.equal(newerReview.earlierVideo.id, saved.id);
    assert.equal(newerReview.newerVideo.id, newer.id);
    assert.equal(newerReview.earlierSongStart, 5);
    assert.equal(newerReview.newerSongStart, 15);
    assert.deepEqual(newerReview.critique.observations, progressCritique.observations);
    assert.equal(await getLibraryVideoDetails('student-b', saved.id), null);
    const otherDetails = await getLibraryVideoDetails('student-b', (await listLibraryVideos('student-b')).find((item) => item.filename === input.filename).id);
    assert.ok(!otherDetails.reviews.some((item) => item.key === paired.key));
    assert.equal(await findPgCritiqueForVideo(input.hash, 'student-a'), null);
    assert.ok(await findPgCritique(unrelated.key, 'student-a'));
    assert.ok(await findPgCritique(otherBaseline.key, 'student-b'));
    assert.ok(await findPgCritique(otherComparison.key, 'student-b'));
    assert.equal((await client.query('SELECT user_id FROM user_critique_deletions WHERE cache_key = $1', [otherBaseline.key])).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM session_critiques WHERE session_id='session-a'")).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM session_critiques WHERE session_id='session-b'")).rowCount, 1);
    await savePersonalVideo(input);
    assert.equal(await findPgCritiqueForVideo(input.hash, 'student-a'), null);
    // Someone else's regeneration does not restore this user's deleted result.
    await savePgCritique(otherBaseline, 'student-b');
    assert.equal(await findPgCritique(baseline.key, 'student-a'), null);
    await savePgCritique(baseline, 'student-a');
    assert.ok(await findPgCritique(baseline.key, 'student-a'));
    assert.equal(await findPgCritique(comparison.key, 'student-a'), null);
    const originalBefore = (await findPgCritique(baseline.key, 'student-a')).critique;
    await savePgCritique({ ...paired, critique: { ...paired.critique, summary: 'Progress and new feedback for the newer take.' } }, 'student-a');
    assert.deepEqual((await findPgCritique(baseline.key, 'student-a')).critique, originalBefore);
    assert.deepEqual((await getLibraryVideoDetails('student-a', saved.id)).reviews.map((review) => review.key), [baseline.key]);
    assert.equal((await getLibraryVideoDetails('student-a', newer.id)).reviews[0].key, paired.key);
    // Keep a group until its final active video is deleted; kept critiques survive.
    const firstInGroup = await savePersonalVideo({ ...input, hash: 'delete-first', filename: 'first.mp4', objectKey: 'delete-first.mp4', groupId: group.id });
    assert.equal(await deleteLibraryVideo('student-a', firstInGroup.id, removeObject), 'deleted');
    assert.ok((await listVideoGroups('student-a')).some((item) => item.id === group.id));
    assert.equal(await deleteLibraryVideo('student-a', newer.id, removeObject), 'deleted');
    assert.ok(!(await listVideoGroups('student-a')).some((item) => item.id === group.id));
    assert.ok(await findPgCritique(paired.key, 'student-a'));
    // The server derives the group from the original video, without a group ID from the client.
    const baseForComparison = await savePersonalVideo({ ...input, hash: 'parent-group', filename: 'original-name.mp4', objectKey: 'parent-group.mp4' });
    const beforeComparisonGroups = (await listVideoGroups('student-a')).length;
    const followup = await savePersonalVideo({ ...input, hash: 'followup-group', filename: 'followup.mp4', objectKey: 'followup-group.mp4', earlierVideoId: baseForComparison.id });
    assert.equal(followup.groupId, baseForComparison.groupId);
    assert.equal((await listVideoGroups('student-a')).length, beforeComparisonGroups);
    assert.equal((await listVideoGroups('student-a')).find((item) => item.id === followup.groupId).name, 'original-name.mp4');
    // A previously uploaded second take stays in its own group; comparison upload cannot move it.
    const standaloneInput = { ...input, hash: 'existing-second', filename: 'second-name.mp4', objectKey: 'existing-second.mp4' };
    const standalone = await savePersonalVideo(standaloneInput);
    const joined = await savePersonalVideo({ ...standaloneInput, earlierVideoId: baseForComparison.id });
    assert.equal(joined.id, standalone.id);
    assert.equal(joined.alreadyExists, true);
    assert.equal(joined.groupId, standalone.groupId);
    assert.equal(joined.existingGroupName, standalone.filename);
    assert.ok((await listVideoGroups('student-a')).some((item) => item.id === standalone.groupId));
    await assert.rejects(savePersonalVideo({ ...standaloneInput, earlierVideoId: 'teacher-video-b' }), /earlier video is unavailable/);
    // An older ungrouped original gets a group named for itself, not for the second take.
    const oldOriginal = await savePersonalVideo({ ...input, hash: 'ungrouped-original', filename: 'old-original.mp4', objectKey: 'ungrouped-original.mp4' });
    await moveLibraryVideo('student-a', oldOriginal.id, null);
    const fromUngrouped = await savePersonalVideo({ ...input, hash: 'new-from-ungrouped', filename: 'new-from-old.mp4', objectKey: 'new-from-ungrouped.mp4', earlierVideoId: oldOriginal.id });
    assert.equal((await findLibraryVideo('student-a', oldOriginal.id)).video.groupId, fromUngrouped.groupId);
    assert.equal((await listVideoGroups('student-a')).find((item) => item.id === fromUngrouped.groupId).name, 'old-original.mp4');
    const editedCopy = await savePersonalVideo({ ...input, filename: 'original-name.mp4', hash: 'different-content', objectKey: 'different-content.mp4' });
    assert.equal(editedCopy.alreadyExists, false);
    assert.notEqual(editedCopy.id, baseForComparison.id, 'Matching filenames do not make different bytes duplicates');
    const emptyGroup = await createVideoGroup('student-a', 'My new practice group');
    const groupCountBeforeFirst = (await listVideoGroups('student-a')).length;
    const firstGroupVideo = await savePersonalVideo({ ...input, hash: 'first-in-custom-group', filename: 'first-take.mp4', objectKey: 'first-in-custom-group.mp4', groupId: emptyGroup.id });
    assert.equal(firstGroupVideo.groupId, emptyGroup.id);
    assert.equal(firstGroupVideo.alreadyExists, false);
    assert.equal((await listVideoGroups('student-a')).length, groupCountBeforeFirst, 'First upload to a named group does not create a filename group');
    assert.equal((await listVideoGroups('student-a')).find((item) => item.id === emptyGroup.id).name, 'My new practice group');
    const anotherEmptyGroup = await createVideoGroup('student-a', 'Group 2');
    const duplicateInGroup2 = await savePersonalVideo({ ...input, hash: 'first-in-custom-group', filename: 'first-take.mp4', objectKey: 'first-in-custom-group.mp4', groupId: anotherEmptyGroup.id });
    const originalGroup = firstGroupVideo.groupId;
    assert.equal(duplicateInGroup2.alreadyExists, true);
    assert.equal(duplicateInGroup2.groupId, originalGroup);
    assert.notEqual(duplicateInGroup2.groupId, anotherEmptyGroup.id);
    assert.equal(duplicateInGroup2.existingGroupName, (await listVideoGroups('student-a')).find((item) => item.id === originalGroup).name);
    assert.ok(!(await listLibraryVideos('student-a')).some((video) => video.groupId === anotherEmptyGroup.id));
    assert.ok((await listVideoGroups('student-a')).some((item) => item.id === anotherEmptyGroup.id), 'The new group remains available for a different upload');
    const olderGroup = await createVideoGroup('student-a', 'Older group');
    const newestGroup = await createVideoGroup('student-a', 'Newest group');
    await client.query("UPDATE video_library_groups SET created_at = '2020-01-01T00:00:00Z' WHERE id = $1", [olderGroup.id]);
    await client.query("UPDATE video_library_groups SET created_at = '2040-01-01T00:00:00Z' WHERE id = $1", [newestGroup.id]);
    const orderedGroups = await listVideoGroups('student-a');
    assert.equal(orderedGroups[0].id, newestGroup.id);
    assert.equal(orderedGroups.at(-1).id, olderGroup.id);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});
