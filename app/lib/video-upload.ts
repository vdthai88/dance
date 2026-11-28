import busboy from "busboy";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { LEGACY_CRITIQUE_BYTES, LEGACY_VIDEO_MB, MAX_VIDEO_BYTES } from "./video-upload-limits";
export { MAX_VIDEO_BYTES } from "./video-upload-limits";

export class VideoUploadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type UploadedVideo = {
  name: string;
  type: string;
  size: number;
  path: string;
  sha256: string;
  stagedKey?: string;
  stream: () => ReadableStream<Uint8Array>;
};

export function isUploadedVideo(value: unknown): value is UploadedVideo {
  return typeof value === "object" && value !== null && "path" in value && "sha256" in value;
}

export type VideoUpload = {
  get: (name: string) => string | UploadedVideo | null;
  cleanup: () => Promise<void>;
};

/** Spool multipart videos to temporary disk with backpressure; never buffer a whole file. */
export async function readVideoUpload(request: Request, fileFields = ["video", "comparisonVideo"], maxBytes = MAX_VIDEO_BYTES): Promise<VideoUpload> {
  if (!request.body) throw new VideoUploadError("Choose a video to upload.");
  const directory = await mkdtemp(join(tmpdir(), "one-dance-upload-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  const values = new Map<string, string | UploadedVideo>();
  const names = new Set<string>();
  const writes: Promise<void>[] = [];
  const abort = new AbortController();
  let failure: Error | undefined;
  let totalFileBytes = 0;
  try {
    const parser = busboy({
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      defParamCharset: "utf8",
      limits: { files: fileFields.length, fields: 12, parts: fileFields.length + 12, fieldSize: 4096, fileSize: maxBytes + 1 },
    });
    const fail = (error: Error) => {
      failure ??= error;
    };
    parser.on("filesLimit", () => fail(new VideoUploadError("Too many video files.")));
    parser.on("fieldsLimit", () => fail(new VideoUploadError("Too many upload fields.")));
    parser.on("partsLimit", () => fail(new VideoUploadError("Too many upload parts.")));
    parser.on("field", (name, value, info) => {
      if (info.valueTruncated || names.has(name)) return fail(new VideoUploadError("Invalid or duplicate upload field."));
      names.add(name);
      values.set(name, value);
    });
    parser.on("file", (name, file, info) => {
      if (!fileFields.includes(name) || names.has(name)) {
        file.resume();
        return fail(new VideoUploadError("Invalid or duplicate video field."));
      }
      names.add(name);
      const path = join(directory, randomUUID());
      const hash = createHash("sha256");
      let size = 0;
      const measure = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        totalFileBytes += chunk.length;
        if (totalFileBytes > maxBytes) {
          const limit = maxBytes === LEGACY_CRITIQUE_BYTES ? LEGACY_VIDEO_MB : Math.floor(maxBytes / 1_000_000);
          return callback(new VideoUploadError(`Video uploads support up to ${limit} MB total. Try smaller clips.`, 413));
        }
        hash.update(chunk);
        callback(null, chunk);
      } });
      const write = pipeline(file, measure, createWriteStream(path, { flags: "wx" }), { signal: abort.signal })
        .then(() => {
          if (file.truncated) throw new VideoUploadError("The video upload is too large.", 413);
          values.set(name, {
            name: info.filename || "video", type: info.mimeType, size, path, sha256: hash.digest("hex"),
            stream: () => Readable.toWeb(createReadStream(path), {
              strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
            }) as ReadableStream<Uint8Array>,
          });
        }).catch((error: Error) => { fail(error); parser.destroy(error); });
      writes.push(write);
    });
    // Limit the entire request too, including multipart headers and discarded fields.
    let requestBytes = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      requestBytes += chunk.length;
      callback(requestBytes > maxBytes + 64 * 1024
        ? new VideoUploadError("The video upload is too large.", 413) : null, chunk);
    } });
    await pipeline(Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>), limit, parser, { signal: request.signal });
    await Promise.all(writes);
    if (failure) throw failure;
    return { get: (name) => values.get(name) ?? null, cleanup };
  } catch (error) {
    abort.abort();
    await Promise.allSettled(writes);
    await cleanup();
    if (failure instanceof VideoUploadError) throw failure;
    if (error instanceof VideoUploadError) throw error;
    throw new VideoUploadError("The video upload was interrupted or invalid. Please retry.");
  }
}
