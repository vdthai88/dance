import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPostgresPool } from "../../db/postgres";
import { ensurePgStudentProfile } from "./postgres-profile-store";

const inviteDetails = `FROM student_roster_invites i
  JOIN organizations o ON o.id = i.company_id
  JOIN "user" teacher ON teacher.id = i.teacher_user_id
  LEFT JOIN user_profiles p ON p.user_id = teacher.id`;
const names = `o.display_name AS "studioName",
  COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), teacher.name) AS "teacherName"`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function permittedStudio(client: PoolClient, teacherId: string, studioId: string) {
  return client.query(`SELECT 1 FROM company_memberships m
    JOIN user_roles r ON r.user_id = m.user_id AND r.role_id = 'teacher'
    WHERE m.user_id = $1 AND m.company_id = $2 AND m.role IN ('owner', 'admin', 'teacher')
    FOR SHARE OF m, r`, [teacherId, studioId]);
}

export async function createRosterInvite(teacherId: string, studioId: string, email: string) {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [teacherId]);
    if (!(await permittedStudio(client, teacherId, studioId)).rowCount) {
      await client.query("ROLLBACK");
      return { status: "forbidden" } as const;
    }
    await client.query(`UPDATE student_roster_invites SET status = 'expired'
       WHERE teacher_user_id = $1 AND status = 'pending' AND expires_at <= now()`, [teacherId]);
    const previous = await client.query(`SELECT 1 FROM student_roster_invites
      WHERE teacher_user_id = $1 AND company_id = $2 AND email = $3 AND status IN ('pending', 'accepted')`, [teacherId, studioId, email]);
    if (previous.rowCount) {
      await client.query("COMMIT");
      return { status: "already-sent" } as const;
    }
    const recent = await client.query(`SELECT count(*)::integer AS count FROM student_roster_invites
      WHERE teacher_user_id = $1 AND created_at > now() - interval '1 hour'`, [teacherId]);
    if (recent.rows[0].count >= 10) {
      await client.query("COMMIT");
      return { status: "rate-limited" } as const;
    }
    const recipient = await client.query('SELECT id FROM "user" WHERE lower(email) = $1 LIMIT 1', [email]);
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    await client.query(`INSERT INTO student_roster_invites (id, token_hash, teacher_user_id, company_id, email, recipient_user_id, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days')`,
      [id, hashToken(token), teacherId, studioId, email, recipient.rows[0]?.id ?? null]);
    const details = await client.query<{ teacherName: string; studioName: string }>(`SELECT ${names} ${inviteDetails} WHERE i.id = $1`, [id]);
    await client.query("COMMIT");
    return { status: "created", id, token, ...details.rows[0] } as const;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function failRosterInviteDelivery(id: string) {
  await getPostgresPool().query("UPDATE student_roster_invites SET status = 'delivery_failed' WHERE id = $1 AND status = 'pending'", [id]);
}

export async function listSentRosterInvites(teacherId: string) {
  const { rows } = await getPostgresPool().query(`SELECT i.id, i.email, o.display_name AS "studioName",
    CASE WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired' ELSE i.status END AS status
    FROM student_roster_invites i JOIN organizations o ON o.id = i.company_id
    WHERE i.teacher_user_id = $1 ORDER BY i.created_at DESC LIMIT 50`, [teacherId]);
  return rows;
}

export async function listReceivedRosterInvites(user: { id: string; email: string }) {
  const { rows } = await getPostgresPool().query(`SELECT i.id, ${names} ${inviteDetails}
    WHERE i.email = $1 AND (i.recipient_user_id IS NULL OR i.recipient_user_id = $2)
      AND i.status = 'pending' AND i.expires_at > now() ORDER BY i.created_at DESC`, [user.email.toLowerCase(), user.id]);
  return rows;
}

export async function findRosterInvite(token: string) {
  const { rows } = await getPostgresPool().query<{
    teacherName: string; studioName: string; email: string; recipientId: string | null; status: string;
  }>(`SELECT ${names}, i.email, i.recipient_user_id AS "recipientId", i.status ${inviteDetails}
    WHERE i.token_hash = $1 AND (i.status = 'accepted' OR (i.status = 'pending' AND i.expires_at > now()))`, [hashToken(token)]);
  return rows[0] ?? null;
}

export async function decideRosterInvite(userId: string, lookup: { token: string } | { id: string }, accept: boolean, automatic: boolean) {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const user = (await client.query('SELECT id, email, "emailVerified" FROM "user" WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    const invite = (await client.query(`SELECT * FROM student_roster_invites
      WHERE ${"token" in lookup ? "token_hash" : "id"} = $1 AND (status = 'accepted' OR expires_at > now()) FOR UPDATE`,
      ["token" in lookup ? hashToken(lookup.token) : lookup.id])).rows[0];
    let result: "unavailable" | "email-mismatch" | "verification-required" | "consent-required" | "accepted" | "declined" = "unavailable";
    if (invite && user) {
      if (user.email.toLowerCase() !== invite.email || (invite.recipient_user_id && invite.recipient_user_id !== userId)) {
        result = "email-mismatch";
      } else if (!user.emailVerified) {
        result = "verification-required";
      } else if (invite.status === "accepted") {
        result = "accepted";
      } else if (invite.status === "pending" && automatic && invite.recipient_user_id) {
        result = "consent-required";
      } else if (invite.status === "pending" && (!accept || (await permittedStudio(client, invite.teacher_user_id, invite.company_id)).rowCount)) {
        if (accept) {
          const studentId = await ensurePgStudentProfile(userId, client);
          await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, 'student') ON CONFLICT DO NOTHING", [userId]);
          await client.query("INSERT INTO student_teacher_assignments (student_id, teacher_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [studentId, invite.teacher_user_id]);
          await client.query("INSERT INTO student_company_assignments (student_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [studentId, invite.company_id]);
          await client.query("UPDATE students SET organization_id = COALESCE(organization_id, $2) WHERE id = $1", [studentId, invite.company_id]);
        }
        result = accept ? "accepted" : "declined";
        await client.query("UPDATE student_roster_invites SET status = $1, recipient_user_id = $2, decided_at = now() WHERE id = $3", [result, userId, invite.id]);
      }
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
