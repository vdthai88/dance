import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { beginDirectUpload, directUploadFromToken, directVideoUploadsEnabled, prepareDirectUpload, proxiedVideoUploadLimit } from "../../lib/direct-video-storage";
import { pgCanAccessSession } from "../../lib/postgres-session-store";
import { deleteLocalVideo } from "../../lib/video-storage";
import { VideoUploadError } from "../../lib/video-upload";
import { LEGACY_CRITIQUE_BYTES, LEGACY_VIDEO_MB, MAX_VIDEO_BYTES, MAX_VIDEO_MB } from "../../lib/video-upload-limits";

export const runtime = "nodejs";

function uploadOptions() {
  const direct = directVideoUploadsEnabled() && usesPostgres();
  const maxBytes = direct ? MAX_VIDEO_BYTES : proxiedVideoUploadLimit();
  return { direct, maxBytes, maxMb: maxBytes === LEGACY_CRITIQUE_BYTES ? LEGACY_VIDEO_MB : MAX_VIDEO_MB };
}

export async function GET() {
  return Response.json(uploadOptions(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Expected JSON." }, { status: 415 });
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "Sign in to upload a video." }, { status: 401 });
    const options = uploadOptions();
    if (!options.direct) return Response.json(options);
    const body = await request.json().catch(() => null);
    if (body?.action === "start") {
      const filename = body.filename;
      const size = body.size;
      const sessionId = body.sessionId ?? null;
      if (typeof filename !== "string" || filename.length > 255 || !/\.(mp4|mov|webm)$/i.test(filename)
        || !Number.isSafeInteger(size) || size <= 0) throw new VideoUploadError("Choose a nonempty MP4, MOV, or WebM video.");
      if (size > MAX_VIDEO_BYTES) throw new VideoUploadError(`Videos can be up to ${MAX_VIDEO_MB} MB.`, 413);
      if (sessionId !== null && (typeof sessionId !== "string" || sessionId.length > 128
        || !await pgCanAccessSession(user.id, sessionId, true) && !await pgCanAccessSession(user.id, sessionId, false))) {
        throw new VideoUploadError("You do not have permission to update this session.", 403);
      }
      return Response.json({ direct: true, token: await beginDirectUpload(user.id, sessionId, filename, size) });
    }
    if (body?.action !== "parts" && body?.action !== "complete" && body?.action !== "discard") throw new VideoUploadError("Invalid upload action.");
    const upload = directUploadFromToken(body.token, user.id);
    if (body.action === "discard") {
      await deleteLocalVideo(upload.key);
      return Response.json({ ok: true });
    }
    return Response.json(await prepareDirectUpload(upload, body.action === "complete"));
  } catch (error) {
    if (error instanceof VideoUploadError) return Response.json({ error: error.message }, { status: error.status });
    if (error && typeof error === "object" && "name" in error && error.name === "NoSuchUpload") {
      return Response.json({ error: "This upload session no longer exists. Choose the video again." }, { status: 410 });
    }
    console.error("Could not prepare direct video upload:", error);
    return Response.json({ error: "The upload could not be prepared. Choose the same video to retry." }, { status: 503 });
  }
}
