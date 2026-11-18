import { getPostgresPool } from "../../db/postgres";
import { isDanceCritique } from "./gemini-critique";
import type { CritiqueRecord, SavedVideoCritique } from "./critique-store";
import { makeCritiqueKey } from "./critique-key";

const asIso = (value: Date | string) => value instanceof Date ? value.toISOString() : value;

export async function findPgCritique(key: string, userId: string): Promise<CritiqueRecord | null> {
  const { rows } = await getPostgresPool().query(`SELECT cache_key, earlier_sha256, newer_sha256, earlier_filename, newer_filename, model, critique_json, earlier_song_start, newer_song_start
    FROM critiques c WHERE cache_key = $1 AND owner_user_id = $2 AND NOT EXISTS
      (SELECT 1 FROM user_critique_deletions d WHERE d.user_id = $2 AND d.cache_key = c.cache_key)`, [key, userId]);
  const row = rows[0] as { cache_key: string; earlier_sha256: string; newer_sha256: string | null; earlier_filename: string; newer_filename: string | null; model: string; critique_json: unknown; earlier_song_start: number; newer_song_start: number } | undefined;
  return row && isDanceCritique(row.critique_json) ? {
    key: row.cache_key, earlierHash: row.earlier_sha256, newerHash: row.newer_sha256,
    earlierFilename: row.earlier_filename, newerFilename: row.newer_filename, model: row.model, critique: row.critique_json,
    earlierSongStart: Number(row.earlier_song_start), newerSongStart: Number(row.newer_song_start),
  } : null;
}

export async function findPgCritiqueForVideo(videoHash: string, userId: string): Promise<SavedVideoCritique | null> {
  const { rows } = await getPostgresPool().query(`SELECT earlier_filename, model, critique_json, created_at FROM critiques
    WHERE earlier_sha256 = $1 AND owner_user_id = $2 AND newer_sha256 IS NULL AND NOT EXISTS
      (SELECT 1 FROM user_critique_deletions d WHERE d.user_id = $2 AND d.cache_key = critiques.cache_key)
    ORDER BY created_at DESC LIMIT 1`, [videoHash, userId]);
  const row = rows[0] as { earlier_filename: string; model: string; critique_json: unknown; created_at: Date | string } | undefined;
  return row && isDanceCritique(row.critique_json)
    ? { filename: row.earlier_filename, model: row.model, critique: row.critique_json, createdAt: asIso(row.created_at) }
    : null;
}

export async function savePgCritique(record: CritiqueRecord, userId: string): Promise<void> {
  if (record.key !== makeCritiqueKey(record.earlierHash, record.newerHash, userId)) throw new Error("The critique key does not belong to this account.");
  const result = await getPostgresPool().query(`INSERT INTO critiques (cache_key, earlier_sha256, newer_sha256, earlier_filename, newer_filename, model, critique_json, owner_user_id, earlier_song_start, newer_song_start)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
    ON CONFLICT (cache_key) DO UPDATE SET earlier_filename = excluded.earlier_filename, newer_filename = excluded.newer_filename,
      model = excluded.model, critique_json = excluded.critique_json, created_at = now(),
      earlier_song_start = excluded.earlier_song_start, newer_song_start = excluded.newer_song_start
    WHERE critiques.owner_user_id = excluded.owner_user_id`,
  [record.key, record.earlierHash, record.newerHash, record.earlierFilename, record.newerFilename, record.model, JSON.stringify(record.critique), userId, record.earlierSongStart ?? 0, record.newerSongStart ?? 0]);
  if (!result.rowCount) throw new Error("The critique could not be saved for this account.");
  // A newly requested critique becomes available again only for its requester.
  await getPostgresPool().query("DELETE FROM user_critique_deletions WHERE user_id = $1 AND cache_key = $2", [userId, record.key]);
}

export async function attachPgSessionCritique(sessionId: string, critiqueKey: string, userId: string): Promise<boolean> {
  try {
    const result = await getPostgresPool().query(`INSERT INTO session_critiques (session_id, cache_key)
      SELECT $1, cache_key FROM critiques WHERE cache_key = $2 AND owner_user_id = $3
      ON CONFLICT (session_id, cache_key) DO UPDATE SET cache_key = excluded.cache_key`, [sessionId, critiqueKey, userId]);
    return Boolean(result.rowCount);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23503") return false;
    throw error;
  }
}
