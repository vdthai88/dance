import { getPostgresPool } from "../../db/postgres";
import { isDanceCritique } from "./gemini-critique";
import type { CritiqueRecord, SavedVideoCritique } from "./critique-store";

const asIso = (value: Date | string) => value instanceof Date ? value.toISOString() : value;

export async function findPgCritique(key: string): Promise<CritiqueRecord | null> {
  const { rows } = await getPostgresPool().query(`SELECT cache_key, earlier_sha256, newer_sha256, earlier_filename, newer_filename, model, critique_json
    FROM critiques WHERE cache_key = $1`, [key]);
  const row = rows[0] as { cache_key: string; earlier_sha256: string; newer_sha256: string | null; earlier_filename: string; newer_filename: string | null; model: string; critique_json: unknown } | undefined;
  return row && isDanceCritique(row.critique_json) ? {
    key: row.cache_key, earlierHash: row.earlier_sha256, newerHash: row.newer_sha256,
    earlierFilename: row.earlier_filename, newerFilename: row.newer_filename, model: row.model, critique: row.critique_json,
  } : null;
}

export async function findPgCritiqueForVideo(videoHash: string): Promise<SavedVideoCritique | null> {
  const { rows } = await getPostgresPool().query(`SELECT earlier_filename, model, critique_json, created_at FROM critiques
    WHERE earlier_sha256 = $1 AND newer_sha256 IS NULL ORDER BY created_at DESC LIMIT 1`, [videoHash]);
  const row = rows[0] as { earlier_filename: string; model: string; critique_json: unknown; created_at: Date | string } | undefined;
  return row && isDanceCritique(row.critique_json)
    ? { filename: row.earlier_filename, model: row.model, critique: row.critique_json, createdAt: asIso(row.created_at) }
    : null;
}

export async function savePgCritique(record: CritiqueRecord): Promise<void> {
  await getPostgresPool().query(`INSERT INTO critiques (cache_key, earlier_sha256, newer_sha256, earlier_filename, newer_filename, model, critique_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    ON CONFLICT (cache_key) DO UPDATE SET earlier_filename = excluded.earlier_filename, newer_filename = excluded.newer_filename,
      model = excluded.model, critique_json = excluded.critique_json, created_at = now()`,
  [record.key, record.earlierHash, record.newerHash, record.earlierFilename, record.newerFilename, record.model, JSON.stringify(record.critique)]);
}

export async function attachPgSessionCritique(sessionId: string, critiqueKey: string): Promise<boolean> {
  try {
    const result = await getPostgresPool().query("INSERT INTO session_critiques (session_id, cache_key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [sessionId, critiqueKey]);
    return result.rowCount !== null;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23503") return false;
    throw error;
  }
}
