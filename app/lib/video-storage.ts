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

function assertLocalStorage() {
  if ((process.env.VIDEO_STORAGE_DRIVER || "local") !== "local") {
    throw new Error("The configured video storage driver is not available yet.");
  }
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
  assertLocalStorage();
  const objectKey = localVideoObjectKey(input);
  const destination = localPath(objectKey);
  await mkdir(resolve(destination, ".."), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.uploading`;
  await writeFile(temporary, input.bytes);
  await rename(temporary, destination);
  return objectKey;
}

export async function readLocalVideo(objectKey: string) {
  assertLocalStorage();
  return readFile(localPath(objectKey));
}

export async function deleteLocalVideo(objectKey: string | null) {
  if (!objectKey) return;
  await rm(localPath(objectKey), { force: true });
}
