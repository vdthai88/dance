import { createHash } from "node:crypto";
import { getPostgresPool } from "../../db/postgres";
import { isDancerDetection, isDancerTarget } from "./dancer-selection";
import type { DancerDetection, DancerTarget } from "./dancer-selection";

export async function getPgDancerSelection(userId: string, hash: string) {
  const { rows } = await getPostgresPool().query("SELECT * FROM video_dancer_selections WHERE user_id=$1 AND video_sha256=$2", [userId, hash]);
  const row = rows[0];
  const target = row ? { description: row.selected_description, referenceSeconds: Number(row.reference_seconds) } : null;
  return { detection: isDancerDetection(row?.detection_json) ? row.detection_json : null,
    target: row?.selected_key && isDancerTarget(target) ? target : null,
    key: row?.selected_key as string | null ?? null };
}
export async function savePgDancerDetection(userId: string, hash: string, detection: DancerDetection) {
  if (!isDancerDetection(detection)) throw new Error("Invalid dancer detection.");
  await getPostgresPool().query(`INSERT INTO video_dancer_selections (user_id,video_sha256,detection_json) VALUES ($1,$2,$3::jsonb)
    ON CONFLICT (user_id,video_sha256) DO UPDATE SET detection_json=excluded.detection_json,updated_at=now()`, [userId,hash,JSON.stringify(detection)]);
}
export async function selectPgDancer(userId: string, hash: string, target: DancerTarget, onlyIfUnselected = false) {
  if (!isDancerTarget(target)) throw new Error("Describe the dancer and choose a valid reference time.");
  const description = target.description.trim();
  const key = createHash("sha256").update(JSON.stringify([description,target.referenceSeconds])).digest("hex");
  await getPostgresPool().query(`INSERT INTO video_dancer_selections (user_id,video_sha256,selected_key,selected_description,reference_seconds)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,video_sha256) DO UPDATE SET
    selected_key=excluded.selected_key,selected_description=excluded.selected_description,reference_seconds=excluded.reference_seconds,updated_at=now()
    WHERE NOT $6::boolean OR video_dancer_selections.selected_key IS NULL`, [userId,hash,key,description,target.referenceSeconds,onlyIfUnselected]);
  return { key, target: { description, referenceSeconds: target.referenceSeconds } };
}
