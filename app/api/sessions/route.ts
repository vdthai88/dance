import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { createPgPracticeSession, listPgSessions, pgCanAccessStudent } from "../../lib/postgres-session-store";
import { canAccessStudent, createPracticeSession, listSessions } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const studentId = new URL(request.url).searchParams.get("studentId");
  const companyId = new URL(request.url).searchParams.get("companyId");
  if (!studentId) return NextResponse.json({ error: "Select a student profile." }, { status: 400 });
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view sessions." }, { status: 401 });
    const asTeacher = new URL(request.url).searchParams.get("scope") === "teacher";
    if (asTeacher && !companyId) return NextResponse.json({ error: "Choose a studio before viewing sessions." }, { status: 400 });
    const hasAccess = usesPostgres()
      ? await pgCanAccessStudent(user.id, studentId, asTeacher, companyId)
      : canAccessStudent(user.id, studentId, asTeacher, companyId);
    if (!hasAccess) return NextResponse.json({ error: "You do not have access to this student." }, { status: 403 });
    const sessions = usesPostgres() ? await listPgSessions(studentId, companyId) : listSessions(studentId, companyId);
    return NextResponse.json(sessions, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not list practice sessions:", error);
    return NextResponse.json({ error: "The session database could not be read." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { studentId?: unknown; companyId?: unknown; sessionDate?: unknown; location?: unknown } | null;
  const studentId = typeof body?.studentId === "string" ? body.studentId : "";
  const sessionDate = typeof body?.sessionDate === "string" ? body.sessionDate : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const companyId = typeof body?.companyId === "string" ? body.companyId : "";
  if (!studentId || !companyId || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) || location.length > 160) {
    return NextResponse.json({ error: "Choose a student and a valid session date." }, { status: 400 });
  }
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to create a session." }, { status: 401 });
    const hasAccess = usesPostgres()
      ? await pgCanAccessStudent(user.id, studentId, true, companyId)
      : canAccessStudent(user.id, studentId, true, companyId);
    if (!hasAccess) return NextResponse.json({ error: "Only a teacher assigned to this studio can create a session for this student." }, { status: 403 });
    const session = usesPostgres()
      ? await createPgPracticeSession({ studentId, companyId, sessionDate, location })
      : createPracticeSession({ studentId, companyId, sessionDate, location });
    if (!session) return NextResponse.json({ error: "That student profile could not be found." }, { status: 404 });
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    console.error("Could not create practice session:", error);
    return NextResponse.json({ error: "The practice session could not be saved." }, { status: 500 });
  }
}
