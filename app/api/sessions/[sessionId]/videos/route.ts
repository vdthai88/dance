import { NextResponse } from "next/server";
import { isUploadedVideo, VideoUploadError } from "../../../../lib/video-upload";
import { readVideoSubmission } from "../../../../lib/direct-video-storage";
import type { VideoUpload } from "../../../../lib/video-upload";
import { getAuthenticatedUser } from "../../../../lib/auth-session";
import { usesPostgres } from "../../../../lib/database-driver";
import { getPgSessionVideoStorageContext, pgCanAccessSession, savePgSessionVideo } from "../../../../lib/postgres-session-store";
import { attachSessionVideo, canAccessSession } from "../../../../lib/session-store";
import { deleteLocalVideo, saveLocalVideo } from "../../../../lib/video-storage";
import { validateUploadedVideo } from "../../../../lib/video-validation";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  let form: VideoUpload | undefined;
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to attach a video." }, { status: 401 });
    const teacherAccess = usesPostgres() ? await pgCanAccessSession(user.id, sessionId, true) : canAccessSession(user.id, sessionId, true);
    const studentAccess = usesPostgres() ? await pgCanAccessSession(user.id, sessionId, false) : canAccessSession(user.id, sessionId, false);
    if (!teacherAccess && !studentAccess) return NextResponse.json({ error: "You do not have permission to update this session." }, { status: 403 });
    form = await readVideoSubmission(request, user.id, sessionId);
    const video = form.get("video");
    if (!isUploadedVideo(video) || video.size === 0) return NextResponse.json({ error: "Choose a video to attach." }, { status: 400 });
    if (!video.type.startsWith("video/")) return NextResponse.json({ error: "Choose a video file." }, { status: 415 });
    await validateUploadedVideo(video);
    const hash = video.sha256;
    let attached: boolean;
    if (usesPostgres()) {
      const context = await getPgSessionVideoStorageContext(sessionId);
      if (!context) return NextResponse.json({ error: "Practice session not found." }, { status: 404 });
      const objectKey = await saveLocalVideo({ companyId: context.companyId, studentId: context.studentId, sessionId, hash, filename: video.name, filePath: video.path, byteSize: video.size }, video.stagedKey);
      try {
        attached = await savePgSessionVideo({ sessionId, userId: user.id, videoHash: hash, filename: video.name, contentType: video.type || null, byteSize: video.size, objectKey });
      } catch (error) {
        await deleteLocalVideo(objectKey);
        throw error;
      }
    } else {
      attached = attachSessionVideo(sessionId, hash, video.name);
    }
    if (!attached) return NextResponse.json({ error: "Practice session not found." }, { status: 404 });
    return NextResponse.json({ filename: video.name, hash });
  } catch (error) {
    if (error instanceof VideoUploadError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Could not attach video to practice session:", error);
    return NextResponse.json({ error: "The video could not be attached to this session." }, { status: 500 });
  } finally {
    await form?.cleanup();
  }
}
