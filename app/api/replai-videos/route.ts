import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { findDuplicatePersonalVideo, findLibraryVideo, listLibraryVideos, listVideoGroups, savePersonalVideo } from "../../lib/video-library-store";
import { isUploadedVideo, VideoUploadError } from "../../lib/video-upload";
import { readVideoSubmission } from "../../lib/direct-video-storage";
import type { VideoUpload } from "../../lib/video-upload";
import { saveLocalVideo } from "../../lib/video-storage";
import { validateUploadedVideo } from "../../lib/video-validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view your videos." }, { status: 401 });
    if (!usesPostgres()) return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(await listLibraryVideos(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not list ReplAI uploads:", error);
    return NextResponse.json({ error: "Your uploaded videos could not be loaded. Try refreshing the list." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let form: VideoUpload | undefined;
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to save a video." }, { status: 401 });
    if (!usesPostgres()) return NextResponse.json({ error: "Saving to your video library is unavailable in this environment." }, { status: 503 });
    form = await readVideoSubmission(request, user.id, null);
    const video = form.get("video");
    if (!isUploadedVideo(video) || !video.size || !video.type.startsWith("video/")) return NextResponse.json({ error: "Choose a nonempty video file." }, { status: 400 });
    const groupId = form.get("groupId");
    const earlierVideoId = form.get("earlierVideoId");
    if (earlierVideoId !== null && (typeof earlierVideoId !== "string" || !earlierVideoId || !await findLibraryVideo(user.id, earlierVideoId))) {
      return NextResponse.json({ error: "The earlier video is unavailable. Refresh your library and try again." }, { status: 400 });
    }
    if (groupId !== null && (typeof groupId !== "string" || !(await listVideoGroups(user.id)).some((group) => group.id === groupId))) {
      return NextResponse.json({ error: "The selected video group is unavailable. Refresh your library and try again." }, { status: 400 });
    }
    const duplicate = await findDuplicatePersonalVideo(user.id, video.sha256);
    if (duplicate) return NextResponse.json(duplicate);
    await validateUploadedVideo(video);
    const objectKey = await saveLocalVideo({ companyId: null, studentId: user.id, sessionId: "replai", hash: video.sha256, filename: video.name, filePath: video.path, byteSize: video.size }, video.stagedKey);
    const saved = await savePersonalVideo({ userId: user.id, filename: video.name, contentType: video.type, byteSize: video.size, hash: video.sha256, objectKey, groupId, earlierVideoId });
    return NextResponse.json(saved, { status: saved.alreadyExists ? 200 : 201 });
  } catch (error) {
    if (error instanceof VideoUploadError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Could not save ReplAI video:", error);
    return NextResponse.json({ error: "Your video could not be saved. Please retry." }, { status: 500 });
  } finally {
    await form?.cleanup();
  }
}
