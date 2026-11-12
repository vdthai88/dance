import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { canAccessSession, getSessionSnapshot } from "../../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view this session." }, { status: 401 });
    if (!canAccessSession(user.id, sessionId, true) && !canAccessSession(user.id, sessionId, false)) {
      return NextResponse.json({ error: "You do not have access to this session." }, { status: 403 });
    }
    const snapshot = getSessionSnapshot(sessionId);
    if (!snapshot) return NextResponse.json({ error: "Practice session not found." }, { status: 404 });
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("Could not load practice session:", error);
    return NextResponse.json({ error: "The practice session could not be loaded." }, { status: 500 });
  }
}
