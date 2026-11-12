import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { canAccessStudent, createPracticeSession, listSessions } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const studentId = new URL(request.url).searchParams.get("studentId");
  if (!studentId) return NextResponse.json({ error: "Select a student profile." }, { status: 400 });
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view sessions." }, { status: 401 });
    const asTeacher = new URL(request.url).searchParams.get("scope") === "teacher";
    if (!canAccessStudent(user.id, studentId, asTeacher)) return NextResponse.json({ error: "You do not have access to this student." }, { status: 403 });
    return NextResponse.json(listSessions(studentId));
  } catch (error) {
    console.error("Could not list practice sessions:", error);
    return NextResponse.json({ error: "The session database could not be read." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { studentId?: unknown; sessionDate?: unknown; location?: unknown } | null;
  const studentId = typeof body?.studentId === "string" ? body.studentId : "";
  const sessionDate = typeof body?.sessionDate === "string" ? body.sessionDate : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) || !location || location.length > 160) {
    return NextResponse.json({ error: "Choose a student, session date, and location (up to 160 characters)." }, { status: 400 });
  }
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to create a session." }, { status: 401 });
    const canManageAsTeacher = canAccessStudent(user.id, studentId, true);
    const canCreateForSelf = canAccessStudent(user.id, studentId, false);
    if (!canManageAsTeacher && !canCreateForSelf) return NextResponse.json({ error: "You do not have permission to create a session for this student." }, { status: 403 });
    const session = createPracticeSession({ studentId, sessionDate, location });
    if (!session) return NextResponse.json({ error: "That student profile could not be found." }, { status: 404 });
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    console.error("Could not create practice session:", error);
    return NextResponse.json({ error: "The practice session could not be saved." }, { status: 500 });
  }
}
