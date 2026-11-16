import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../../../lib/auth-session";
import { usesPostgres } from "../../../../../lib/database-driver";
import { findPgSessionVideo, pgCanAccessSession } from "../../../../../lib/postgres-session-store";
import { readLocalVideo } from "../../../../../lib/video-storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string; hash: string }> }) {
  if (!usesPostgres()) return NextResponse.json({ error: "Local video storage is available after the PostgreSQL driver is enabled." }, { status: 409 });
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to play this video." }, { status: 401 });
  const { sessionId, hash } = await context.params;
  const hasAccess = await pgCanAccessSession(user.id, sessionId, true) || await pgCanAccessSession(user.id, sessionId, false);
  if (!hasAccess) return NextResponse.json({ error: "You do not have access to this session." }, { status: 403 });
  const video = await findPgSessionVideo(sessionId, hash);
  if (!video || video.storageStatus !== "ready" || !video.objectKey) return NextResponse.json({ error: "This video was not stored locally. Upload it again to play it." }, { status: 404 });
  try {
    const bytes = await readLocalVideo(video.objectKey);
    return new NextResponse(bytes, { headers: {
      "Content-Type": video.contentType || "video/mp4",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${video.filename.replace(/[\\\"]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    } });
  } catch {
    return NextResponse.json({ error: "The local video file is missing. Upload it again to restore playback." }, { status: 404 });
  }
}
