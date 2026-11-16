import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { usesPostgres } from "../../../lib/database-driver";
import { deletePgSessionTeacherFeedback, findPgSessionTeacherFeedback, pgCanAccessSession, updatePgSessionTeacherFeedback } from "../../../lib/postgres-session-store";
import { canAccessSession, deleteSessionTeacherFeedback, findSessionTeacherFeedback, updateSessionTeacherFeedback } from "../../../lib/session-store";

export const runtime = "nodejs";

async function editableFeedback(request: Request, id: string) {
  const user = await getAuthenticatedUser(request);
  if (!user) return { error: NextResponse.json({ error: "Sign in to manage feedback." }, { status: 401 }) };
  const feedback = usesPostgres() ? await findPgSessionTeacherFeedback(id) : findSessionTeacherFeedback(id);
  if (!feedback) return { error: NextResponse.json({ error: "Feedback note not found." }, { status: 404 }) };
  const hasAccess = usesPostgres() ? await pgCanAccessSession(user.id, feedback.sessionId, true) : canAccessSession(user.id, feedback.sessionId, true);
  if (!hasAccess) return { error: NextResponse.json({ error: "You do not have permission to manage feedback for this session." }, { status: 403 }) };
  return { feedback };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await editableFeedback(request, id);
  if ("error" in access) return access.error;
  const body = await request.json().catch(() => null) as { summary?: unknown } | null;
  const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
  if (!summary || summary.length > 4000) return NextResponse.json({ error: "Enter a feedback note up to 4,000 characters." }, { status: 400 });
  const updated = usesPostgres()
    ? await updatePgSessionTeacherFeedback(id, { ...access.feedback.feedback, summary })
    : updateSessionTeacherFeedback(id, { ...access.feedback.feedback, summary });
  return NextResponse.json(updated);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await editableFeedback(request, id);
  if ("error" in access) return access.error;
  if (usesPostgres()) await deletePgSessionTeacherFeedback(id);
  else deleteSessionTeacherFeedback(id);
  return new NextResponse(null, { status: 204 });
}
