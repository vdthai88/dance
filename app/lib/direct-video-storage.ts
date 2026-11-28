import { CompleteMultipartUploadCommand, CreateMultipartUploadCommand, GetObjectCommand, HeadObjectCommand, ListPartsCommand, UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { configuredDriver, r2Client } from "./video-storage";
import { readVideoUpload, VideoUploadError } from "./video-upload";
import type { VideoUpload } from "./video-upload";
import { LEGACY_CRITIQUE_BYTES, MAX_VIDEO_BYTES, VIDEO_PART_BYTES, videoMimeType } from "./video-upload-limits";

export function directVideoUploadsEnabled() {
  return configuredDriver() === "r2" && process.env.VIDEO_DIRECT_UPLOADS === "true";
}

export function proxiedVideoUploadLimit() {
  return configuredDriver() === "r2" ? LEGACY_CRITIQUE_BYTES : MAX_VIDEO_BYTES;
}

type Upload = { userId: string; sessionId: string | null; key: string; uploadId: string; filename: string; type: string; size: number; expires: number };

function signature(payload: string) {
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  if (!secret) throw new Error("R2 credentials are missing.");
  return createHmac("sha256", secret).update("direct-video-upload:").update(payload).digest();
}

export function directUploadFromToken(token: unknown, userId: string) {
  if (typeof token !== "string" || token.length > 6000 || !/^[\w-]+\.[\w-]{43}$/.test(token)) {
    throw new VideoUploadError("This upload session is invalid. Choose the video again.");
  }
  const [payload, mac] = token.split(".");
  if (!timingSafeEqual(signature(payload), Buffer.from(mac, "base64url"))) {
    throw new VideoUploadError("This upload session is invalid. Choose the video again.");
  }
  const upload = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Upload;
  if (upload.userId !== userId) throw new VideoUploadError("This upload belongs to a different account.", 403);
  if (upload.expires <= Date.now()) throw new VideoUploadError("This upload session has expired. Choose the video again.", 410);
  return upload;
}

export async function beginDirectUpload(userId: string, sessionId: string | null, filename: string, size: number) {
  const type = videoMimeType(filename);
  const key = `incoming-video/${randomUUID()}`;
  const { client, bucket } = r2Client();
  try {
    const { UploadId } = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: type }));
    if (!UploadId) throw new Error("R2 did not start the multipart upload.");
    const upload: Upload = { userId, sessionId, key, uploadId: UploadId, filename, size, type, expires: Date.now() + 24 * 60 * 60 * 1000 };
    const payload = Buffer.from(JSON.stringify(upload)).toString("base64url");
    return `${payload}.${signature(payload).toString("base64url")}`;
  } finally { client.destroy(); }
}

export async function prepareDirectUpload(upload: Upload, complete: boolean) {
  const { client, bucket } = r2Client();
  const object = { Bucket: bucket, Key: upload.key };
  const multipart = { ...object, UploadId: upload.uploadId };
  try {
    try {
      const head = await client.send(new HeadObjectCommand(object));
      if (head.ContentLength !== upload.size) throw new VideoUploadError("The uploaded video size did not match.", 422);
      return { complete: true, parts: [] };
    } catch (error) {
      if (!(error && typeof error === "object" && "$metadata" in error
        && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404)) throw error;
    }
    const listed = await client.send(new ListPartsCommand(multipart));
    const uploaded = new Map(listed.Parts?.map((part) => [part.PartNumber, part]));
    const count = Math.ceil(upload.size / VIDEO_PART_BYTES);
    const parts = Array.from({ length: count }, (_, index) => {
      const number = index + 1;
      const size = Math.min(VIDEO_PART_BYTES, upload.size - index * VIDEO_PART_BYTES);
      const stored = uploaded.get(number);
      return { number, size, etag: stored?.Size === size ? stored?.ETag : undefined };
    });
    if (complete) {
      if (parts.some(({ etag }) => !etag)) throw new VideoUploadError("Some parts are missing. Select the same video to resume.", 409);
      await client.send(new CompleteMultipartUploadCommand({
        ...multipart, MultipartUpload: { Parts: parts.map(({ number, etag }) => ({ PartNumber: number, ETag: etag })) },
      }));
      return { complete: true, parts: [] };
    }
    return {
      complete: false,
      parts: await Promise.all(parts.map(async ({ number, size, etag }) => ({
        number, size,
        url: etag ? undefined : await getSignedUrl(client, new UploadPartCommand({ ...multipart, PartNumber: number, ContentLength: size }),
          { expiresIn: 3600, signableHeaders: new Set(["content-length"]) }),
      }))),
    };
  } finally { client.destroy(); }
}

export async function readVideoSubmission(request: Request, userId: string, sessionId: string | null): Promise<VideoUpload> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return readVideoUpload(request, ["video"], proxiedVideoUploadLimit());
  if (!directVideoUploadsEnabled()) throw new VideoUploadError("Direct video uploads are unavailable in this environment.", 503);
  const fields = await request.json().catch(() => null);
  const upload = directUploadFromToken(fields?.uploadToken, userId);
  if (upload.sessionId !== sessionId) throw new VideoUploadError("This video was uploaded for a different destination.", 403);
  const directory = await mkdtemp(join(tmpdir(), "one-dance-direct-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  const path = join(directory, "video");
  const { client, bucket } = r2Client();
  try {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: upload.key }), { abortSignal: request.signal });
    if (!(object.Body instanceof Readable)) throw new Error("R2 returned no video stream.");
    if (object.ContentLength !== upload.size || upload.size > MAX_VIDEO_BYTES) {
      object.Body.destroy();
      throw new VideoUploadError("The uploaded video size did not match.", 422);
    }
    const hash = createHash("sha256");
    let size = 0;
    const measure = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > upload.size) return callback(new VideoUploadError("The uploaded video size did not match.", 422));
      hash.update(chunk);
      callback(null, chunk);
    } });
    await pipeline(object.Body, measure, createWriteStream(path), { signal: request.signal });
    if (size !== upload.size) throw new VideoUploadError("The uploaded video is incomplete. Please retry.", 422);
    const video = {
      name: upload.filename, type: upload.type, size, path, sha256: hash.digest("hex"), stagedKey: upload.key,
      stream: () => Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,
    };
    return { get: (name) => name === "video" ? video : typeof fields[name] === "string" ? fields[name] : null, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  } finally { client.destroy(); }
}
