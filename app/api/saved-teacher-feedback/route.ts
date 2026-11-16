import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { getPgSessionSnapshot, pgCanAccessSession } from "../../lib/postgres-session-store";
import { canAccessSession, getSessionSnapshot } from "../../lib/session-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Choose a video to load its teacher notes." }, { status: 400 });
  const sessionId = form.get("sessionId");
  if (typeof sessionId !== "string" || !sessionId) return NextResponse.json({ error: "Choose a practice session to load its teacher notes." }, { status: 400 });
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view teacher feedback." }, { status: 401 });
    const hasTeacherAccess = usesPostgres() ? await pgCanAccessSession(user.id, sessionId, true) : canAccessSession(user.id, sessionId, true);
    const hasStudentAccess = usesPostgres() ? await pgCanAccessSession(user.id, sessionId, false) : canAccessSession(user.id, sessionId, false);
    if (!hasTeacherAccess && !hasStudentAccess) {
      return NextResponse.json({ error: "You do not have access to this session." }, { status: 403 });
    }
    const snapshot = usesPostgres() ? await getPgSessionSnapshot(sessionId) : getSessionSnapshot(sessionId);
    if (!snapshot) return NextResponse.json({ error: "Practice session not found." }, { status: 404 });
    return NextResponse.json(snapshot.teacherFeedback);
  } catch (error) {
    console.error("Could not load saved teacher feedback:", error);
    return NextResponse.json({ error: "The local teacher-feedback database could not be read." }, { status: 500 });
  }
}
