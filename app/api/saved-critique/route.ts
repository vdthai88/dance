import { NextResponse } from "next/server";
import { usesPostgres } from "../../lib/database-driver";
import { findCritiqueForVideo } from "../../lib/critique-store";
import { findPgCritiqueForVideo } from "../../lib/postgres-critique-store";
import { isUploadedVideo, readVideoUpload, VideoUploadError } from "../../lib/video-upload";
import type { VideoUpload } from "../../lib/video-upload";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let form: VideoUpload;
  try {
    form = await readVideoUpload(request, ["video"]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof VideoUploadError ? error.message : "The upload could not be read." }, { status: error instanceof VideoUploadError ? error.status : 500 });
  }
  try {
    const video = form.get("video");
    if (!isUploadedVideo(video)) return NextResponse.json({ error: "Choose a video to look up its saved critique." }, { status: 400 });
    const hash = video.sha256;
    const saved = usesPostgres() ? await findPgCritiqueForVideo(hash) : findCritiqueForVideo(hash);
    return NextResponse.json(saved);
  } catch (error) {
    console.error("Could not look up the saved critique:", error);
    return NextResponse.json({ error: "The local critique database could not be read." }, { status: 500 });
  } finally {
    await form.cleanup();
  }
}
