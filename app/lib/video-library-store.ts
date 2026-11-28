import { randomUUID } from "node:crypto";
import { getPostgresPool } from "../../db/postgres";
import type { LibraryUploadResult, LibraryVideo, LibraryVideoDetails, VideoGroup } from "./video-library-types";
import { deleteLocalVideo } from "./video-storage";
import { DANCE_SCORE_CATEGORIES, isDanceCritique, totalDanceScore } from "./gemini-critique";

type VideoRow = {
  id: string; original_filename: string; content_type: string | null;
  byte_size: string | number | null; created_at: Date | string;
  session_name: string | null; object_key: string | null; storage_status: string; sha256: string;
  uploaded_by_user_id: string;
  group_id?: string | null;
};

function mapVideo(row: VideoRow, userId: string): LibraryVideo {
  return {
    id: row.id, filename: row.original_filename, contentType: row.content_type,
    byteSize: Number(row.byte_size ?? 0),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    sessionName: row.session_name,
    available: row.storage_status === "ready" && Boolean(row.object_key),
    canDelete: row.uploaded_by_user_id === userId,
    groupId: row.group_id ?? null,
  };
}

// ReplAI is the signed-in student's personal space, independent of teacher mode.
// Session videos uploaded by a teacher are visible only to their actual student.
const ownVideos = `FROM videos v
  LEFT JOIN practice_sessions ps ON ps.id = v.session_id
  LEFT JOIN students s ON s.id = ps.student_id
  LEFT JOIN video_library_group_items gi ON gi.video_id = v.id AND gi.user_id = $1
  WHERE ((v.session_id IS NULL AND v.uploaded_by_user_id = $1) OR s.user_id = $1)
    AND v.storage_status <> 'deleted'`;

export async function listLibraryVideos(userId: string): Promise<LibraryVideo[]> {
  const { rows } = await getPostgresPool().query(`SELECT v.*, ps.session_name, gi.group_id ${ownVideos}
    ORDER BY v.created_at DESC, v.id DESC LIMIT 100`, [userId]);
  return (rows as VideoRow[]).map((row) => mapVideo(row, userId));
}

export async function findLibraryVideo(userId: string, id: string) {
  const { rows } = await getPostgresPool().query(`SELECT v.*, ps.session_name, gi.group_id ${ownVideos} AND v.id = $2`, [userId, id]);
  const row = rows[0] as VideoRow | undefined;
  return row ? { video: mapVideo(row, userId), objectKey: row.object_key, hash: row.sha256 } : null;
}

async function scoreDistribution() {
  const categoryTotals = Object.entries(DANCE_SCORE_CATEGORIES).map(([key, { maximum }]) => {
    const value = `(c.critique_json #> '{scores,${key}}')`;
    return `CASE WHEN jsonb_typeof(${value}) = 'number' THEN
      CASE WHEN ${value}::numeric BETWEEN 0 AND ${maximum}
        AND trunc(${value}::numeric) = ${value}::numeric THEN ${value}::int END
      END`;
  });
  const { rows } = await getPostgresPool().query<{ score: number; entries: number }>(`
    SELECT score, count(*)::int AS entries
    FROM (
      SELECT ${categoryTotals.join(" + ")} AS score
      FROM critiques c
      WHERE c.owner_user_id IS NOT NULL AND c.critique_json ? 'scores'
        AND NOT EXISTS (SELECT 1 FROM user_critique_deletions d
          WHERE d.user_id = c.owner_user_id AND d.cache_key = c.cache_key)
    ) scores
    WHERE score IS NOT NULL
    GROUP BY score ORDER BY score DESC`);
  let place = 1;
  const places = new Map(rows.map(({ score, entries }) => {
    const rank = place;
    place += entries;
    return [score, rank] as const;
  }));
  return { places, totalScores: place - 1 };
}

export async function getLibraryVideoDetails(userId: string, id: string): Promise<LibraryVideoDetails | null> {
  const found = await findLibraryVideo(userId, id);
  if (!found) return null;
  const pool = getPostgresPool();
  const { rows } = await pool.query(`SELECT c.* FROM critiques c WHERE owner_user_id = $1
    AND (CASE WHEN newer_sha256 IS NULL THEN earlier_subject_key ELSE newer_subject_key END) IS NOT DISTINCT FROM
      (SELECT selected_key FROM video_dancer_selections WHERE user_id = $1 AND video_sha256 = $2)
    AND ((earlier_sha256 = $2 AND newer_sha256 IS NULL) OR newer_sha256 = $2) AND NOT EXISTS
      (SELECT 1 FROM user_critique_deletions d WHERE d.user_id = $1 AND d.cache_key = c.cache_key)
    ORDER BY c.created_at DESC LIMIT 30`, [userId, found.hash]);
  const reviews = rows.flatMap((row) => {
    if (!isDanceCritique(row.critique_json)) return [];
    return [{ row, critique: row.critique_json, total: row.critique_json.scores ? totalDanceScore(row.critique_json.scores) : null }];
  });
  const hashes = [...new Set(reviews.flatMap(({ row }) => [row.earlier_sha256, row.newer_sha256]).filter(Boolean))];
  const [related, distribution] = await Promise.all([
    hashes.length ? pool.query(`SELECT v.*, ps.session_name, gi.group_id ${ownVideos}
      AND v.sha256 = ANY($2::text[]) ORDER BY (v.session_id IS NULL) DESC, v.created_at DESC`, [userId, hashes]) : { rows: [] },
    reviews.some(({ total }) => total !== null) ? scoreDistribution() : null,
  ]);
  const videoForHash = (hash: string | null) => {
    if (!hash) return null;
    if (hash === found.hash) return found.video;
    const row = (related.rows as VideoRow[]).find((video) => video.sha256 === hash);
    return row ? mapVideo(row, userId) : null;
  };
  return { video: found.video, reviews: reviews.map(({ row, critique, total }) => {
    const place = total === null ? undefined : distribution?.places.get(total);
    return {
      key: row.cache_key as string, createdAt: new Date(row.created_at).toISOString(), critique,
      earlierVideo: videoForHash(row.earlier_sha256), newerVideo: videoForHash(row.newer_sha256),
      comparison: Boolean(row.newer_sha256), earlierSongStart: Number(row.earlier_song_start), newerSongStart: Number(row.newer_song_start),
      ...(place !== undefined && distribution ? { scoreRanking: { place, totalScores: distribution.totalScores } } : {}),
    };
  }) };
}

export async function listVideoGroups(userId: string): Promise<VideoGroup[]> {
  const { rows } = await getPostgresPool().query("SELECT id, name, collapsed FROM video_library_groups WHERE user_id = $1 ORDER BY created_at DESC, id DESC", [userId]);
  return rows as VideoGroup[];
}

export async function createVideoGroup(userId: string, name: string): Promise<VideoGroup> {
  const { rows } = await getPostgresPool().query("INSERT INTO video_library_groups (id, user_id, name) VALUES ($1, $2, $3) RETURNING id, name, collapsed", [randomUUID(), userId, name.trim()]);
  return rows[0] as VideoGroup;
}

export async function updateVideoGroup(userId: string, id: string, changes: { name?: string; collapsed?: boolean }): Promise<VideoGroup | null> {
  const { rows } = await getPostgresPool().query(`UPDATE video_library_groups SET name = COALESCE($3, name), collapsed = COALESCE($4, collapsed)
    WHERE id = $1 AND user_id = $2 RETURNING id, name, collapsed`, [id, userId, changes.name?.trim() ?? null, changes.collapsed ?? null]);
  return rows[0] as VideoGroup | undefined ?? null;
}

export async function moveLibraryVideo(userId: string, videoId: string, groupId: string | null): Promise<boolean> {
  // A single statement checks both the video and group ownership; no client-supplied user ID is accepted.
  if (groupId === null) {
    if (!await findLibraryVideo(userId, videoId)) return false;
    await getPostgresPool().query("DELETE FROM video_library_group_items WHERE user_id = $1 AND video_id = $2", [userId, videoId]);
    return true;
  }
  const { rowCount } = await getPostgresPool().query(`INSERT INTO video_library_group_items (user_id, video_id, group_id)
    SELECT $1, v.id, $3 ${ownVideos} AND v.id = $2
      AND EXISTS (SELECT 1 FROM video_library_groups g WHERE g.id = $3 AND g.user_id = $1)
    ON CONFLICT (user_id, video_id) DO UPDATE SET group_id = excluded.group_id`, [userId, videoId, groupId]);
  return Boolean(rowCount);
}

export async function findDuplicatePersonalVideo(userId: string, hash: string): Promise<LibraryUploadResult | null> {
  const { rows } = await getPostgresPool().query(`SELECT v.*, NULL::text AS session_name, gi.group_id, g.name AS group_name
    FROM videos v LEFT JOIN video_library_group_items gi ON gi.video_id = v.id AND gi.user_id = $1
    LEFT JOIN video_library_groups g ON g.id = gi.group_id AND g.user_id = $1
    WHERE v.uploaded_by_user_id = $1 AND v.sha256 = $2 AND v.session_id IS NULL
      AND v.storage_status = 'ready' AND v.object_key IS NOT NULL`, [userId, hash]);
  const row = rows[0];
  return row ? { ...mapVideo(row as VideoRow, userId), alreadyExists: true, existingGroupName: row.group_name ?? null } : null;
}

export async function savePersonalVideo(input: { userId: string; filename: string; contentType: string; byteSize: number; hash: string; objectKey: string; groupId?: string | null; earlierVideoId?: string | null }): Promise<LibraryUploadResult> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    // Serialize detection and save for this account/file so concurrent uploads
    // cannot both report that the same personal video is new.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify([input.userId, input.hash])]);
    const prior = await client.query(`SELECT v.*, NULL::text AS session_name, gi.group_id, g.name AS group_name
      FROM videos v LEFT JOIN video_library_group_items gi ON gi.video_id = v.id AND gi.user_id = $1
      LEFT JOIN video_library_groups g ON g.id = gi.group_id AND g.user_id = $1
      WHERE v.uploaded_by_user_id = $1 AND v.sha256 = $2 AND v.session_id IS NULL
        AND v.storage_status = 'ready' AND v.object_key IS NOT NULL FOR UPDATE OF v`, [input.userId, input.hash]);
    if (prior.rows[0]) {
      // A repeated upload is informational, never an instruction to move or rename
      // a saved video, update its upload date, or create another group.
      if (input.earlierVideoId) {
        const original = await client.query(`SELECT v.id ${ownVideos} AND v.id = $2`, [input.userId, input.earlierVideoId]);
        if (!original.rowCount) throw new Error("The earlier video is unavailable.");
      } else if (input.groupId) {
        const target = await client.query("SELECT id FROM video_library_groups WHERE id = $1 AND user_id = $2", [input.groupId, input.userId]);
        if (!target.rowCount) throw new Error("The selected video group is unavailable.");
      }
      await client.query("COMMIT");
      return { ...mapVideo(prior.rows[0] as VideoRow, input.userId), alreadyExists: true, existingGroupName: prior.rows[0].group_name ?? null };
    }
    let targetGroupId = input.groupId;
    if (input.earlierVideoId) {
      const earlier = await client.query(`SELECT v.id, v.original_filename, gi.group_id ${ownVideos} AND v.id = $2 FOR UPDATE OF v`, [input.userId, input.earlierVideoId]);
      const original = earlier.rows[0];
      if (!original) throw new Error("The earlier video is unavailable.");
      const originalGroup = await client.query("SELECT group_id FROM video_library_group_items WHERE user_id = $1 AND video_id = $2", [input.userId, original.id]);
      targetGroupId = originalGroup.rows[0]?.group_id as string | undefined;
      if (!targetGroupId) {
        targetGroupId = randomUUID();
        await client.query("INSERT INTO video_library_groups (id, user_id, name) VALUES ($1, $2, $3)", [targetGroupId, input.userId, String(original.original_filename).trim().slice(0, 100) || "Video"]);
        await client.query("INSERT INTO video_library_group_items (user_id, video_id, group_id) VALUES ($1, $2, $3)", [input.userId, original.id, targetGroupId]);
      }
    }
    if (targetGroupId) {
      const target = await client.query("SELECT id FROM video_library_groups WHERE id = $1 AND user_id = $2 FOR SHARE", [targetGroupId, input.userId]);
      if (!target.rowCount) throw new Error("The selected video group is unavailable.");
    }
    const { rows } = await client.query(`INSERT INTO videos
      (id, session_id, uploaded_by_user_id, object_key, original_filename, content_type, byte_size, sha256, storage_status)
      VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, 'ready')
      ON CONFLICT (uploaded_by_user_id, sha256) WHERE session_id IS NULL
      DO UPDATE SET object_key = excluded.object_key, original_filename = excluded.original_filename,
        content_type = excluded.content_type, byte_size = excluded.byte_size, storage_status = 'ready', created_at = now()
      RETURNING *, NULL::text AS session_name`,
    [randomUUID(), input.userId, input.objectKey, input.filename, input.contentType, input.byteSize, input.hash]);
    const row = rows[0] as VideoRow;
    const existing = await client.query("SELECT group_id FROM video_library_group_items WHERE user_id = $1 AND video_id = $2", [input.userId, row.id]);
    const previousGroupId = existing.rows[0]?.group_id as string | undefined;
    let groupId = targetGroupId || previousGroupId;
    if (!groupId) {
      groupId = randomUUID();
      await client.query("INSERT INTO video_library_groups (id, user_id, name) VALUES ($1, $2, $3)", [groupId, input.userId, input.filename.trim().slice(0, 100) || "Video"]);
    }
    await client.query(`INSERT INTO video_library_group_items (user_id, video_id, group_id) VALUES ($1, $2, $3)
      ON CONFLICT (user_id, video_id) DO UPDATE SET group_id = excluded.group_id`, [input.userId, row.id, groupId]);
    if (previousGroupId && previousGroupId !== groupId) {
      await client.query(`DELETE FROM video_library_groups g WHERE g.id = $1 AND g.user_id = $2
        AND NOT EXISTS (SELECT 1 FROM video_library_group_items gi JOIN videos v ON v.id = gi.video_id
          WHERE gi.group_id = g.id AND v.storage_status <> 'deleted')`, [previousGroupId, input.userId]);
    }
    await client.query("COMMIT");
    return { ...mapVideo({ ...row, group_id: groupId }, input.userId), alreadyExists: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** Remove an owned upload, optionally also removing its AI critiques for this account. */
export async function deleteLibraryVideo(userId: string, id: string, removeObject = deleteLocalVideo, deleteCritiques = false): Promise<"deleted" | "not-found" | "forbidden"> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT v.* ${ownVideos} AND v.id = $2 FOR UPDATE OF v`, [userId, id]);
    const row = rows[0] as VideoRow | undefined;
    if (!row || row.uploaded_by_user_id !== userId) {
      await client.query("ROLLBACK");
      return row ? "forbidden" : "not-found";
    }
    if (deleteCritiques) {
      await client.query(`INSERT INTO user_critique_deletions (user_id, cache_key)
        SELECT $1, cache_key FROM critiques WHERE owner_user_id = $1 AND (earlier_sha256 = $2 OR newer_sha256 = $2)
        ON CONFLICT (user_id, cache_key) DO NOTHING`, [userId, row.sha256]);
      await client.query(`DELETE FROM session_critiques sc USING practice_sessions ps, students s, critiques c
        WHERE sc.session_id = ps.id AND ps.student_id = s.id AND s.user_id = $1
          AND sc.cache_key = c.cache_key AND c.owner_user_id = $1 AND (c.earlier_sha256 = $2 OR c.newer_sha256 = $2)`, [userId, row.sha256]);
    }
    await client.query("UPDATE videos SET storage_status = 'deleted', object_key = NULL WHERE id = $1", [id]);
    // Lock affected groups so concurrent uploads/deletions cannot leave an empty group.
    const affected = await client.query(`SELECT g.id FROM video_library_groups g
      JOIN video_library_group_items gi ON gi.group_id = g.id AND gi.user_id = g.user_id
      WHERE gi.video_id = $1 ORDER BY g.id FOR UPDATE OF g`, [id]);
    await client.query("DELETE FROM video_library_group_items WHERE video_id = $1", [id]);
    for (const group of affected.rows) {
      await client.query(`DELETE FROM video_library_groups g WHERE g.id = $1 AND NOT EXISTS
        (SELECT 1 FROM video_library_group_items gi JOIN videos v ON v.id = gi.video_id
          WHERE gi.group_id = g.id AND v.storage_status <> 'deleted')`, [group.id]);
    }
    // Validate all database changes before deleting bytes. Roll back the entry
    // and critique changes if storage deletion fails, so the user can retry.
    await removeObject(row.object_key);
    await client.query("COMMIT");
    return "deleted";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
