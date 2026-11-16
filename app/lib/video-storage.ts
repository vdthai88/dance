import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

export type LocalVideoWrite = {
  companyId: string | null;
  studentId: string;
  sessionId: string;
  hash: string;
  filename: string;
  bytes: Uint8Array;
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
  if (!target.startsWith(`${root}\\`) && target !== root) throw new Error("Invalid local video object key.");
  return target;
}

export async function saveLocalVideo(input: LocalVideoWrite) {
  const objectKey = localVideoObjectKey(input);
  if (configuredDriver() === "r2") {
    const { bucket, client } = r2Client();
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: input.bytes,
      ContentType: mimeTypeForFilename(input.filename),
      Metadata: { "original-filename": safeMetadata(input.filename), sha256: input.hash },
    }));
    return objectKey;
  }
  const destination = localPath(objectKey);
  await mkdir(resolve(destination, ".."), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.uploading`;
  await writeFile(temporary, input.bytes);
  await rename(temporary, destination);
  return objectKey;
}

export async function readLocalVideo(objectKey: string) {
  if (configuredDriver() === "r2") {
    const { bucket, client } = r2Client();
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    if (!result.Body) throw new Error("R2 returned an empty video object.");
    return new Uint8Array(await result.Body.transformToByteArray());
  }
  return readFile(localPath(objectKey));
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
