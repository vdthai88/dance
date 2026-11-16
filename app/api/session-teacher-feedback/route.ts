import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { pgCanAccessSession, savePgSessionTeacherFeedback } from "../../lib/postgres-session-store";
import { canAccessSession, saveSessionTeacherFeedback } from "../../lib/session-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { sessionId?: unknown; summary?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
  if (!sessionId || !summary || summary.length > 4000) return NextResponse.json({ error: "Enter a feedback note up to 4,000 characters." }, { status: 400 });
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to add feedback." }, { status: 401 });
  const hasAccess = usesPostgres() ? await pgCanAccessSession(user.id, sessionId, true) : canAccessSession(user.id, sessionId, true);
  if (!hasAccess) return NextResponse.json({ error: "You do not have permission to add feedback to this session." }, { status: 403 });
  const feedback = { summary, actionItems: [] };
  return NextResponse.json(usesPostgres()
    ? await savePgSessionTeacherFeedback({ sessionId, model: "teacher-manual", feedback })
    : saveSessionTeacherFeedback({ sessionId, model: "teacher-manual", feedback }), { status: 201 });
}
