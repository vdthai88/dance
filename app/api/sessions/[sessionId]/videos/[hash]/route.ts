import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../../../lib/auth-session";
import { usesPostgres } from "../../../../../lib/database-driver";
import { findPgSessionVideo, pgCanAccessSession } from "../../../../../lib/postgres-session-store";
import { streamLocalVideo, VideoRangeError } from "../../../../../lib/video-storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string; hash: string }> }) {
  if (!usesPostgres()) return NextResponse.json({ error: "Local video storage is available after the PostgreSQL driver is enabled." }, { status: 409 });
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to play this video." }, { status: 401 });
  const { sessionId, hash } = await context.params;
  const hasAccess = await pgCanAccessSession(user.id, sessionId, true) || await pgCanAccessSession(user.id, sessionId, false);
  if (!hasAccess) return NextResponse.json({ error: "You do not have access to this session." }, { status: 403 });
  const video = await findPgSessionVideo(sessionId, hash);
  if (!video || video.storageStatus !== "ready" || !video.objectKey) return NextResponse.json({ error: "This video is not available in storage. Upload it again to play it." }, { status: 404 });
  try {
    const stored = await streamLocalVideo(video.objectKey, request.headers.get("range"));
    return new NextResponse(stored.body, { status: stored.status, headers: {
      ...stored.headers,
      "Content-Type": video.contentType || "video/mp4",
      "Content-Disposition": `inline; filename="${video.filename.replace(/[\\\"]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    if (error instanceof VideoRangeError) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${error.size}` } });
    return NextResponse.json({ error: "The stored video file is missing. Upload it again to restore playback." }, { status: 404 });
  }
}
