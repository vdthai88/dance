import { getPostgresPool } from "../../db/postgres";
import type { ProTrial } from "./pro-trial-types";

type TrialRow = { started_at: Date | string; ends_at: Date | string | null; teacher_role_added_at: Date | string | null };
const iso = (date: Date | string) => new Date(date).toISOString();
function mapTrial(row: TrialRow): ProTrial {
  return { startedAt: iso(row.started_at), endsAt: row.ends_at ? iso(row.ends_at) : null, teacherRoleAddedAt: row.teacher_role_added_at ? iso(row.teacher_role_added_at) : null };
}

export async function getPgProTrial(userId: string): Promise<ProTrial | null> {
  const { rows } = await getPostgresPool().query(`SELECT t.started_at, t.ends_at, ur.created_at AS teacher_role_added_at
    FROM user_pro_trials t LEFT JOIN user_roles ur ON ur.user_id = t.user_id AND ur.role_id = 'teacher' WHERE t.user_id = $1`, [userId]);
  return rows[0] ? mapTrial(rows[0] as TrialRow) : null;
}

export async function startPgProTrial(userId: string, days: number | null = null): Promise<{ trial: ProTrial; alreadyStarted: boolean }> {
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new Error("Trial duration must be a whole number from 1 to 365 days.");
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const user = await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [userId]);
    if (!user.rowCount) throw new Error("Account not found.");
    await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, 'teacher') ON CONFLICT DO NOTHING", [userId]);
    const inserted = await client.query(`INSERT INTO user_pro_trials (user_id, ends_at)
      VALUES ($1, CASE WHEN $2::integer IS NULL THEN NULL ELSE now() + make_interval(days => $2::integer) END)
      ON CONFLICT (user_id) DO NOTHING RETURNING user_id`, [userId, days]);
    const { rows } = await client.query(`SELECT t.started_at, t.ends_at, ur.created_at AS teacher_role_added_at
      FROM user_pro_trials t JOIN user_roles ur ON ur.user_id = t.user_id AND ur.role_id = 'teacher' WHERE t.user_id = $1`, [userId]);
    await client.query("COMMIT");
    return { trial: mapTrial(rows[0] as TrialRow), alreadyStarted: !inserted.rowCount };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
