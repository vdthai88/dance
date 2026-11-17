import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";

export type LocalVideoWrite = {
  companyId: string | null;
  studentId: string;
  sessionId: string;
  hash: string;
  filename: string;
  filePath: string;
  byteSize: number;
};

function storageRoot() {
  // Local development storage is deliberately outside Next's traced source tree.
  return resolve(/* turbopackIgnore: true */ process.cwd(), process.env.LOCAL_UPLOAD_DIR || "data/uploads");
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "video";
}

type VideoStorageDriver = "local" | "r2";

function configuredDriver(): VideoStorageDriver {
  const value = process.env.VIDEO_STORAGE_DRIVER || "local";
  if (value === "local" || value === "r2") return value;
  throw new Error(`Unsupported VIDEO_STORAGE_DRIVER: ${value}. Use local or r2.`);
}

function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error("R2 storage requires R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ENDPOINT (or R2_ACCOUNT_ID).");
  }
  return { bucket, accessKeyId, secretAccessKey, endpoint };
}

function r2Client() {
  const config = r2Config();
  return {
    bucket: config.bucket,
    client: new S3Client({
      region: "auto",
      requestChecksumCalculation: "WHEN_REQUIRED",
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
  };
}

export function localVideoObjectKey(input: LocalVideoWrite) {
  const fileHash = safeSegment(input.hash).slice(0, 24);
  const extension = basename(input.filename).includes(".") ? `.${safeSegment(basename(input.filename).split(".").pop() ?? "mp4")}` : "";
  return [
    "companies", safeSegment(input.companyId || "personal"), "students", safeSegment(input.studentId),
    "sessions", safeSegment(input.sessionId), `${fileHash}${extension}`,
  ].join("/");
}

function localPath(objectKey: string) {
  const root = storageRoot();
  const target = resolve(/* turbopackIgnore: true */ root, ...objectKey.split("/"));
  const child = relative(root, target);
  if (child.startsWith("..") || isAbsolute(child)) throw new Error("Invalid local video object key.");
  return target;
}

export async function saveLocalVideo(input: LocalVideoWrite) {
  const objectKey = localVideoObjectKey(input);
  if (configuredDriver() === "r2") {
    const { bucket, client } = r2Client();
    const body = createReadStream(input.filePath);
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: body,
        ContentLength: input.byteSize,
        ContentType: mimeTypeForFilename(input.filename),
        Metadata: { "original-filename": safeMetadata(input.filename), sha256: input.hash },
      }));
    } finally {
      body.destroy();
      client.destroy();
    }
    return objectKey;
  }
  const destination = localPath(objectKey);
  await mkdir(resolve(destination, ".."), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.uploading`;
  try {
    await copyFile(input.filePath, temporary);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return objectKey;
}

export class VideoRangeError extends Error {
  size: number;
  constructor(size: number) { super("Invalid video byte range."); this.size = size; }
}

function videoRange(header: string | null, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new VideoRangeError(size);
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new VideoRangeError(size);
  return { start, end };
}

/** Return a cancellable stream for playback instead of allocating the complete video. */
export async function streamLocalVideo(objectKey: string, rangeHeader: string | null = null) {
  const remote = configuredDriver() === "r2" ? r2Client() : null;
  try {
    const size = remote
      ? (await remote.client.send(new HeadObjectCommand({ Bucket: remote.bucket, Key: objectKey }))).ContentLength
      : (await stat(localPath(objectKey))).size;
    if (size === undefined || size === 0) throw new Error("The stored video is empty.");
    const range = videoRange(rangeHeader, size);
    let body: Readable;
    if (remote) {
      const result = await remote.client.send(new GetObjectCommand({
        Bucket: remote.bucket, Key: objectKey,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }));
      if (!(result.Body instanceof Readable)) throw new Error("R2 returned no video stream.");
      body = result.Body;
      body.once("close", () => remote.client.destroy());
    } else {
      body = createReadStream(localPath(objectKey), range ?? {});
    }
    return {
      body: Readable.toWeb(body, {
        strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
      }) as ReadableStream<Uint8Array>,
      status: range ? 206 : 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(range ? range.end - range.start + 1 : size),
        ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
      },
    };
  } catch (error) {
    remote?.client.destroy();
    throw error;
  }
}

export async function deleteLocalVideo(objectKey: string | null) {
  if (!objectKey) return;
  if (configuredDriver() === "r2") {
    const { bucket, client } = r2Client();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    return;
  }
  await rm(localPath(objectKey), { force: true });
}

function mimeTypeForFilename(filename: string) {
  const extension = basename(filename).split(".").pop()?.toLowerCase();
  return extension === "mov" ? "video/quicktime" : extension === "webm" ? "video/webm" : "video/mp4";
}

function safeMetadata(value: string) {
  return value.replace(/[\r\n]/g, " ").slice(0, 1024);
}
