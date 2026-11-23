import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPostgresPool } from "../../db/postgres";
import type { CompanyJoinRequest, CompanyMember, ConnectionOption, ConnectionRequest, Invitation, TeacherOrganization } from "./session-store";

const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : value;
type CompanyType = TeacherOrganization["type"];

export async function listPgCompanies(): Promise<TeacherOrganization[]> {
  const { rows } = await getPostgresPool().query("SELECT id, display_name, organization_type, address, phone_number FROM organizations ORDER BY display_name");
  return rows.map((row) => ({ id: row.id as string, name: row.display_name as string, type: row.organization_type as CompanyType, address: row.address as string, phoneNumber: row.phone_number as string }));
}

export async function listPgOwnedCompanies(userId: string): Promise<TeacherOrganization[]> {
  const { rows } = await getPostgresPool().query(`SELECT o.id, o.display_name, o.organization_type, o.address, o.phone_number
    FROM company_memberships cm JOIN organizations o ON o.id = cm.company_id
    WHERE cm.user_id = $1 AND cm.role = 'owner' ORDER BY o.display_name`, [userId]);
  return rows.map((row) => ({ id: row.id as string, name: row.display_name as string, type: row.organization_type as CompanyType, address: row.address as string, phoneNumber: row.phone_number as string }));
}

export async function updatePgOwnedCompany(userId: string, companyId: string, input: { name: string; type: CompanyType; address: string; phoneNumber: string }): Promise<TeacherOrganization | "exists" | null> {
  const pool = getPostgresPool();
  if (!(await pool.query("SELECT 1 FROM company_memberships WHERE company_id=$1 AND user_id=$2 AND role='owner'", [companyId, userId])).rowCount) return null;
  if ((await pool.query("SELECT 1 FROM organizations WHERE lower(display_name)=lower($1) AND id<>$2", [input.name.trim(), companyId])).rowCount) return "exists";
  const { rows } = await pool.query(`UPDATE organizations SET display_name=$1, organization_type=$2, address=$3, phone_number=$4 WHERE id=$5
    RETURNING id, display_name, organization_type, address, phone_number`, [input.name.trim(), input.type, input.address.trim(), input.phoneNumber.trim(), companyId]);
  const row = rows[0];
  return row ? { id: row.id as string, name: row.display_name as string, type: row.organization_type as CompanyType, address: row.address as string, phoneNumber: row.phone_number as string } : null;
}

export async function listPgCompanyMembers(userId: string): Promise<CompanyMember[]> {
  const pool = getPostgresPool();
  const membership = await pool.query("SELECT company_id FROM company_memberships WHERE user_id=$1 AND role IN ('owner','admin') LIMIT 1", [userId]);
  const companyId = membership.rows[0]?.company_id as string | undefined;
  if (!companyId) return [];
  const { rows } = await pool.query(`SELECT cm.user_id, COALESCE(u.name,tp.display_name,'Team member') AS display_name, u.email, cm.role, cm.joined_at
    FROM company_memberships cm LEFT JOIN "user" u ON u.id=cm.user_id LEFT JOIN teacher_profiles tp ON tp.user_id=cm.user_id
    WHERE cm.company_id=$1 ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'teacher' THEN 2 ELSE 3 END, display_name`, [companyId]);
  return rows.map((row) => ({ userId: row.user_id as string, name: row.display_name as string, email: row.email as string | null, role: row.role as CompanyMember["role"], joinedAt: iso(row.joined_at as Date | string) }));
}

async function ensurePgTeacherProfile(client: PoolClient, userId: string, companyId?: string | null) {
  const found = await client.query("SELECT id FROM teacher_profiles WHERE user_id = $1", [userId]);
  if (found.rowCount) return found.rows[0].id as string;
  const user = await client.query('SELECT name FROM "user" WHERE id = $1', [userId]);
  const id = randomUUID();
  await client.query("INSERT INTO teacher_profiles (id, display_name, user_id, organization_id) VALUES ($1,$2,$3,$4)", [id, user.rows[0]?.name ?? "Teacher", userId, companyId ?? null]);
  return id;
}

export async function createPgCompanyForTeacher(userId: string, input: { name: string; type: CompanyType; address?: string; phoneNumber?: string }): Promise<TeacherOrganization | "exists"> {
  const client = await getPostgresPool().connect();
  try {
    const existing = await client.query("SELECT 1 FROM organizations WHERE lower(display_name) = lower($1)", [input.name.trim()]);
    if (existing.rowCount) return "exists";
    await client.query("BEGIN");
    const id = randomUUID();
    await client.query("INSERT INTO organizations (id, display_name, organization_type, address, phone_number) VALUES ($1,$2,$3,$4,$5)", [id, input.name.trim(), input.type, input.address?.trim() ?? "", input.phoneNumber?.trim() ?? ""]);
    await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, 'teacher') ON CONFLICT DO NOTHING", [userId]);
    await client.query("UPDATE company_memberships SET is_default = false WHERE user_id = $1", [userId]);
    await client.query("INSERT INTO company_memberships (company_id, user_id, role, is_default) VALUES ($1,$2,'owner',true)", [id, userId]);
    const profileId = await ensurePgTeacherProfile(client, userId, id);
    await client.query("UPDATE teacher_profiles SET organization_id = $1, is_company_owner = true WHERE id = $2", [id, profileId]);
    await client.query("COMMIT");
    return { id, name: input.name.trim(), type: input.type, address: input.address?.trim() ?? "", phoneNumber: input.phoneNumber?.trim() ?? "", isDefault: true };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function requestPgCompanyJoin(userId: string, companyId: string): Promise<"created" | "already_member" | "already_requested" | "missing"> {
  const pool = getPostgresPool();
  if (!(await pool.query("SELECT 1 FROM organizations WHERE id = $1", [companyId])).rowCount) return "missing";
  if ((await pool.query("SELECT 1 FROM company_memberships WHERE company_id = $1 AND user_id = $2", [companyId, userId])).rowCount) return "already_member";
  if ((await pool.query("SELECT 1 FROM company_join_requests WHERE company_id = $1 AND requester_user_id = $2 AND status = 'pending'", [companyId, userId])).rowCount) return "already_requested";
  await pool.query("INSERT INTO company_join_requests (id, company_id, requester_user_id) VALUES ($1,$2,$3)", [randomUUID(), companyId, userId]);
  return "created";
}

export async function listPgPendingCompanyJoinRequests(userId: string): Promise<CompanyJoinRequest[]> {
  const { rows } = await getPostgresPool().query(`SELECT r.id, r.company_id, o.display_name AS company_name, r.requested_at,
    COALESCE(NULLIF(trim(concat_ws(' ', up.first_name, up.last_name)), ''), NULLIF(trim(u.name), ''), 'Teacher') AS requester_name
    FROM company_join_requests r JOIN company_memberships cm ON cm.company_id = r.company_id AND cm.user_id = $1 AND cm.role IN ('owner','admin')
    JOIN organizations o ON o.id = r.company_id LEFT JOIN "user" u ON u.id = r.requester_user_id LEFT JOIN user_profiles up ON up.user_id = r.requester_user_id
    WHERE r.status = 'pending' ORDER BY r.requested_at DESC`, [userId]);
  return rows.map((row) => ({ id: row.id as string, companyId: row.company_id as string, companyName: row.company_name as string, requesterName: row.requester_name as string, requestedAt: iso(row.requested_at as Date | string) }));
}

export async function decidePgCompanyJoinRequest(userId: string, requestId: string, accept: boolean): Promise<boolean> {
  const client = await getPostgresPool().connect();
  try {
    const request = await client.query("SELECT company_id, requester_user_id FROM company_join_requests WHERE id = $1 AND status = 'pending'", [requestId]);
    const item = request.rows[0] as { company_id: string; requester_user_id: string } | undefined;
    if (!item || !(await client.query("SELECT 1 FROM company_memberships WHERE company_id=$1 AND user_id=$2 AND role IN ('owner','admin')", [item.company_id, userId])).rowCount) return false;
    await client.query("BEGIN");
    if (accept) {
      await client.query("INSERT INTO company_memberships (company_id,user_id,role) VALUES ($1,$2,'teacher') ON CONFLICT DO NOTHING", [item.company_id, item.requester_user_id]);
      const defaults = await client.query("SELECT 1 FROM company_memberships WHERE user_id=$1 AND is_default=true", [item.requester_user_id]);
      if (!defaults.rowCount) await client.query("UPDATE company_memberships SET is_default=true WHERE company_id=$1 AND user_id=$2", [item.company_id, item.requester_user_id]);
      await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1,'teacher') ON CONFLICT DO NOTHING", [item.requester_user_id]);
      const profileId = await ensurePgTeacherProfile(client, item.requester_user_id, item.company_id);
      await client.query("UPDATE teacher_profiles SET organization_id = COALESCE(organization_id,$1) WHERE id=$2", [item.company_id, profileId]);
    }
    await client.query("UPDATE company_join_requests SET status=$1, decided_at=now() WHERE id=$2", [accept ? "accepted" : "declined", requestId]);
    await client.query("COMMIT"); return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function listPgConnectionOptions(): Promise<ConnectionOption[]> {
  const pool = getPostgresPool();
  const [teachers, companies] = await Promise.all([
    pool.query(`SELECT DISTINCT tp.user_id AS id, COALESCE(NULLIF(trim(concat_ws(' ',up.first_name,up.last_name)),''),NULLIF(trim(u.name),''),NULLIF(trim(tp.display_name),''),'Teacher') AS name, o.display_name AS company_name
      FROM teacher_profiles tp LEFT JOIN "user" u ON u.id=tp.user_id LEFT JOIN user_profiles up ON up.user_id=tp.user_id LEFT JOIN company_memberships cm ON cm.user_id=tp.user_id AND cm.role IN ('owner','admin','teacher') LEFT JOIN organizations o ON o.id=cm.company_id WHERE tp.user_id IS NOT NULL ORDER BY company_name,name`),
    pool.query("SELECT id, display_name AS name FROM organizations ORDER BY display_name"),
  ]);
  return [...teachers.rows.map((row) => ({ type: "teacher" as const, id: row.id as string, name: row.name as string, companyName: row.company_name as string | null })), ...companies.rows.map((row) => ({ type: "company" as const, id: row.id as string, name: row.name as string, companyName: row.name as string }))];
}

export async function listPgStudentPendingConnectionRequests(userId: string): Promise<ConnectionRequest[]> {
  return queryPgConnectionRequests(`WHERE s.user_id = $1 AND cr.status = 'pending' ORDER BY cr.requested_at DESC`, [userId]);
}

export async function listPgPendingConnectionRequests(userId: string): Promise<ConnectionRequest[]> {
  return queryPgConnectionRequests(`LEFT JOIN company_memberships cm ON cm.company_id = cr.target_company_id AND cm.user_id = $1
    WHERE cr.status='pending' AND (cr.target_user_id=$1 OR cm.role IN ('owner','admin')) ORDER BY cr.requested_at DESC`, [userId]);
}

async function queryPgConnectionRequests(where: string, values: string[]): Promise<ConnectionRequest[]> {
  const { rows } = await getPostgresPool().query(`SELECT cr.id,s.display_name AS student_name,cr.target_type,cr.requested_at,
    COALESCE(NULLIF(trim(concat_ws(' ',up.first_name,up.last_name)),''),NULLIF(trim(tu.name),''),NULLIF(trim(tp.display_name),''),o.display_name,'Unknown recipient') AS target_name
    FROM connection_requests cr JOIN students s ON s.id=cr.student_id LEFT JOIN teacher_profiles tp ON tp.user_id=cr.target_user_id LEFT JOIN "user" tu ON tu.id=cr.target_user_id LEFT JOIN user_profiles up ON up.user_id=cr.target_user_id LEFT JOIN organizations o ON o.id=cr.target_company_id ${where}`, values);
  return rows.map((row) => ({ id: row.id as string, studentName: row.student_name as string, targetName: row.target_name as string, targetType: row.target_type as ConnectionRequest["targetType"], requestedAt: iso(row.requested_at as Date | string) }));
}

export async function requestPgConnection(userId: string, input: { type: "teacher" | "company"; targetId: string }): Promise<boolean> {
  const pool = getPostgresPool();
  const student = await pool.query("SELECT id FROM students WHERE user_id=$1", [userId]);
  if (!student.rowCount) return false;
  const valid = input.type === "teacher" ? await pool.query("SELECT 1 FROM teacher_profiles WHERE user_id=$1", [input.targetId]) : await pool.query("SELECT 1 FROM organizations WHERE id=$1", [input.targetId]);
  if (!valid.rowCount) return false;
  await pool.query("INSERT INTO connection_requests (id,student_id,target_type,target_user_id,target_company_id) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), student.rows[0].id, input.type, input.type === "teacher" ? input.targetId : null, input.type === "company" ? input.targetId : null]);
  return true;
}

export async function cancelPgConnectionRequest(userId: string, requestId: string): Promise<boolean> {
  return Boolean((await getPostgresPool().query(`DELETE FROM connection_requests WHERE id=$1 AND status='pending' AND student_id IN (SELECT id FROM students WHERE user_id=$2)`, [requestId, userId])).rowCount);
}

export async function decidePgConnectionRequest(userId: string, requestId: string, accept: boolean): Promise<boolean> {
  const client = await getPostgresPool().connect();
  try {
    const result = await client.query("SELECT * FROM connection_requests WHERE id=$1 AND status='pending'", [requestId]);
    const r = result.rows[0] as { student_id: string; target_type: "teacher" | "company"; target_user_id: string | null; target_company_id: string | null } | undefined;
    if (!r) return false;
    const permitted = r.target_type === "teacher" ? r.target_user_id === userId : Boolean(r.target_company_id && (await client.query("SELECT 1 FROM company_memberships WHERE company_id=$1 AND user_id=$2 AND role IN ('owner','admin')", [r.target_company_id, userId])).rowCount);
    if (!permitted) return false;
    await client.query("BEGIN");
    if (accept) {
      const companyId = r.target_type === "company" ? r.target_company_id : (await client.query("SELECT organization_id FROM teacher_profiles WHERE user_id=$1", [r.target_user_id])).rows[0]?.organization_id as string | null;
      if (r.target_type === "teacher") await client.query("INSERT INTO student_teacher_assignments (student_id,teacher_user_id,permission) VALUES ($1,$2,'manage') ON CONFLICT DO NOTHING", [r.student_id, r.target_user_id]);
      if (companyId) { await client.query("INSERT INTO student_company_assignments (student_id,company_id,permission) VALUES ($1,$2,'manage') ON CONFLICT DO NOTHING", [r.student_id, companyId]); await client.query("UPDATE students SET organization_id=COALESCE(organization_id,$1) WHERE id=$2", [companyId,r.student_id]); }
    }
    await client.query("UPDATE connection_requests SET status=$1,decided_at=now() WHERE id=$2", [accept ? "accepted" : "declined",requestId]);
    await client.query("COMMIT"); return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function createPgInvitation(input: { userId: string; email: string; role: "teacher" | "student"; studentId?: string | null }): Promise<Invitation | null> {
  const pool = getPostgresPool();
  const membership = await pool.query("SELECT company_id FROM company_memberships WHERE user_id=$1 AND role IN ('owner','admin') LIMIT 1", [input.userId]);
  const companyId = membership.rows[0]?.company_id as string | undefined;
  if (!companyId || (input.role === "student" && (!input.studentId || !(await pool.query("SELECT 1 FROM student_company_assignments WHERE student_id=$1 AND company_id=$2", [input.studentId,companyId])).rowCount))) return null;
  const token = randomBytes(24).toString("base64url"); const expiresAt = new Date(Date.now()+14*24*60*60*1000).toISOString();
  const { rows } = await pool.query(`INSERT INTO invitations (id,token,company_id,student_id,email,invitation_role,invited_by_user_id,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING created_at`, [randomUUID(),token,companyId,input.studentId ?? null,input.email.toLowerCase(),input.role,input.userId,expiresAt]);
  return { token,email:input.email.toLowerCase(),role:input.role,studentId:input.studentId ?? null,status:"pending",expiresAt,createdAt:iso(rows[0].created_at as Date|string) };
}

export async function acceptPgInvitation(user: { id: string; email: string; name: string }, token: string): Promise<{ role: "teacher" | "student" } | "invalid" | "email_mismatch"> {
  const client = await getPostgresPool().connect();
  try {
    const found = await client.query("SELECT * FROM invitations WHERE token=$1 AND status='pending' AND expires_at > now()", [token]);
    const invite = found.rows[0] as { company_id:string; student_id:string|null; email:string; invitation_role:"teacher"|"student" }|undefined;
    if (!invite) return "invalid"; if (invite.email.toLowerCase() !== user.email.toLowerCase()) return "email_mismatch";
    await client.query("BEGIN");
    if (invite.invitation_role === "teacher") { await client.query("INSERT INTO company_memberships (company_id,user_id,role) VALUES ($1,$2,'teacher') ON CONFLICT DO NOTHING",[invite.company_id,user.id]); await client.query("INSERT INTO user_roles (user_id,role_id) VALUES ($1,'teacher') ON CONFLICT DO NOTHING",[user.id]); await ensurePgTeacherProfile(client,user.id,invite.company_id); }
    else if (invite.student_id) { const updated=await client.query("UPDATE students SET user_id=$1 WHERE id=$2 AND (user_id IS NULL OR user_id=$1)",[user.id,invite.student_id]); if (!updated.rowCount) { await client.query("ROLLBACK"); return "invalid"; } await client.query("INSERT INTO user_roles (user_id,role_id) VALUES ($1,'student') ON CONFLICT DO NOTHING",[user.id]); }
    await client.query("UPDATE invitations SET status='accepted',accepted_at=now() WHERE token=$1",[token]); await client.query("COMMIT"); return {role:invite.invitation_role};
  } catch(error){ await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
