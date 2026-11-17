import { randomUUID } from "node:crypto";
import { getPostgresPool } from "../../db/postgres";
import type { LibraryVideo } from "./video-library-types";

type VideoRow = {
  id: string; original_filename: string; content_type: string | null;
  byte_size: string | number | null; created_at: Date | string;
  session_name: string | null; object_key: string | null; storage_status: string; sha256: string;
};

function mapVideo(row: VideoRow): LibraryVideo {
  return {
    id: row.id, filename: row.original_filename, contentType: row.content_type,
    byteSize: Number(row.byte_size ?? 0),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    sessionName: row.session_name,
    available: row.storage_status === "ready" && Boolean(row.object_key),
  };
}

// ReplAI is the signed-in student's personal space, independent of teacher mode.
// Session videos uploaded by a teacher are visible only to their actual student.
const ownVideos = `FROM videos v
  LEFT JOIN practice_sessions ps ON ps.id = v.session_id
  LEFT JOIN students s ON s.id = ps.student_id
  WHERE ((v.session_id IS NULL AND v.uploaded_by_user_id = $1) OR s.user_id = $1)
    AND v.storage_status <> 'deleted'`;

export async function listLibraryVideos(userId: string): Promise<LibraryVideo[]> {
  const { rows } = await getPostgresPool().query(`SELECT v.*, ps.session_name ${ownVideos}
    ORDER BY v.created_at DESC, v.id DESC LIMIT 100`, [userId]);
  return (rows as VideoRow[]).map(mapVideo);
}

export async function findLibraryVideo(userId: string, id: string) {
  const { rows } = await getPostgresPool().query(`SELECT v.*, ps.session_name ${ownVideos} AND v.id = $2`, [userId, id]);
  const row = rows[0] as VideoRow | undefined;
  return row ? { video: mapVideo(row), objectKey: row.object_key, hash: row.sha256 } : null;
}

export async function savePersonalVideo(input: { userId: string; filename: string; contentType: string; byteSize: number; hash: string; objectKey: string }): Promise<LibraryVideo> {
  const { rows } = await getPostgresPool().query(`INSERT INTO videos
    (id, session_id, uploaded_by_user_id, object_key, original_filename, content_type, byte_size, sha256, storage_status)
    VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, 'ready')
    ON CONFLICT (uploaded_by_user_id, sha256) WHERE session_id IS NULL
    DO UPDATE SET object_key = excluded.object_key, original_filename = excluded.original_filename,
      content_type = excluded.content_type, byte_size = excluded.byte_size, storage_status = 'ready'
    RETURNING *, NULL::text AS session_name`,
  [randomUUID(), input.userId, input.objectKey, input.filename, input.contentType, input.byteSize, input.hash]);
  return mapVideo(rows[0] as VideoRow);
}
