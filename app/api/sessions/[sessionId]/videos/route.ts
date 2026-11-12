import { NextResponse } from "next/server";
import { fingerprintVideo } from "../../../../lib/critique-store";
import { getAuthenticatedUser } from "../../../../lib/auth-session";
import { attachSessionVideo, canAccessSession } from "../../../../lib/session-store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const form = await request.formData().catch(() => null);
  const video = form?.get("video");
  if (!(video instanceof File) || video.size === 0) return NextResponse.json({ error: "Choose a video to attach." }, { status: 400 });
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to attach a video." }, { status: 401 });
    if (!canAccessSession(user.id, sessionId, true)) return NextResponse.json({ error: "You do not have permission to update this session." }, { status: 403 });
    const hash = await fingerprintVideo(video);
    if (!attachSessionVideo(sessionId, hash, video.name)) return NextResponse.json({ error: "Practice session not found." }, { status: 404 });
    return NextResponse.json({ filename: video.name, hash });
  } catch (error) {
    console.error("Could not attach video to practice session:", error);
    return NextResponse.json({ error: "The video could not be attached to this session." }, { status: 500 });
  }
}
