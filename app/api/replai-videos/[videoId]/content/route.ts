import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../../lib/auth-session";
import { usesPostgres } from "../../../../lib/database-driver";
import { findLibraryVideo } from "../../../../lib/video-library-store";
import { streamLocalVideo, VideoRangeError } from "../../../../lib/video-storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ videoId: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to play your video." }, { status: 401 });
    if (!usesPostgres()) return new NextResponse(null, { status: 404 });
    const { videoId } = await context.params;
    const found = await findLibraryVideo(user.id, videoId);
    if (!found?.video.available || !found.objectKey) return NextResponse.json({ error: "This video is unavailable. Upload it again to restore playback." }, { status: 404 });
    const stored = await streamLocalVideo(found.objectKey, request.headers.get("range"));
    return new NextResponse(stored.body, { status: stored.status, headers: {
      ...stored.headers, "Content-Type": found.video.contentType || "video/mp4", "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    if (error instanceof VideoRangeError) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${error.size}` } });
    console.error("Could not play ReplAI video:", error);
    return NextResponse.json({ error: "This video could not be played. Try again or upload it again." }, { status: 500 });
  }
}
