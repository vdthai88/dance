import { readApiJson } from "./api-response";
import { MAX_VIDEO_BYTES, MAX_VIDEO_MB, VIDEO_PART_BYTES, videoMimeType } from "./video-upload-limits";

type Part = { number: number; size: number; url?: string };
type UploadState = { complete: boolean; parts: Part[] };

function post(path: string, body: object) {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function uploadKey(path: string, file: File) {
  // Sampling distinguishes different recordings with identical file metadata.
  if (!globalThis.crypto?.subtle) return null;
  const sampleSize = 64 * 1024;
  const starts = [0, Math.floor(file.size / 2), Math.max(0, file.size - sampleSize)];
  const samples = new Blob(starts.map((start) => file.slice(start, start + sampleSize)));
  const bytes = await crypto.subtle.digest("SHA-256", await samples.arrayBuffer());
  const digest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `video-upload:${path}:${file.name}:${file.size}:${digest}`;
}

async function sendPart(url: string, data: Blob) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { method: "PUT", body: data, signal: AbortSignal.timeout(180_000) });
      if (response.ok) return;
      if (response.status < 500 && response.status !== 429) break;
    } catch {
      // Retrying a part number replaces only that part.
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error("A video part could not be uploaded. Choose the same file again to resume.");
}

export async function uploadVideo(path: string, file: File, options: {
  sessionId?: string; fields?: Record<string, string>; onProgress?: (percent: number) => void;
} = {}) {
  if (file.size > MAX_VIDEO_BYTES) throw new Error(`Videos can be up to ${MAX_VIDEO_MB} MB.`);
  const key = await uploadKey(path, file);
  let token: string | null = null;
  if (key) {
    try { token = localStorage.getItem(key); } catch { /* Upload can still run in this tab. */ }
  }
  let state: UploadState | undefined;
  if (token) {
    const response = await post("/api/video-uploads", { action: "parts", token });
    if (response.status === 410 || response.status === 403) token = null;
    else state = await readApiJson(response, "Resume upload", "Could not resume the video upload.") as UploadState;
    if (state && !Array.isArray(state.parts)) token = null;
  }
  if (!token) {
    const response = await post("/api/video-uploads", { action: "start", filename: file.name, size: file.size, sessionId: options.sessionId });
    const start = await readApiJson(response, "Start upload", "Could not start the video upload.") as { direct: boolean; token?: string; maxBytes?: number; maxMb?: number };
    if (!start.direct) {
      if (start.maxBytes && file.size > start.maxBytes) throw new Error(`This environment accepts videos up to ${start.maxMb} MB.`);
      const form = new FormData();
      form.set("video", file.type.startsWith("video/") ? file : file.slice(0, file.size, videoMimeType(file.name)), file.name);
      for (const [name, value] of Object.entries(options.fields ?? {})) form.set(name, value);
      return fetch(path, { method: "POST", body: form });
    }
    if (!start.token) throw new Error("The upload session could not be started.");
    token = start.token;
    if (key) {
      try { localStorage.setItem(key, token); } catch { /* Upload can still run in this tab. */ }
    }
    const parts = await post("/api/video-uploads", { action: "parts", token });
    state = await readApiJson(parts, "Prepare upload", "Could not prepare the video upload.") as UploadState;
  }
  if (!state) throw new Error("The upload session could not be prepared.");
  let uploaded = state.parts.reduce((total, part) => total + (part.url ? 0 : part.size), 0);
  for (const part of state.parts) {
    if (!part.url) continue;
    options.onProgress?.(Math.floor(uploaded * 100 / file.size));
    const offset = (part.number - 1) * VIDEO_PART_BYTES;
    await sendPart(part.url, file.slice(offset, offset + part.size));
    uploaded += part.size;
  }
  if (!state.complete) {
    const complete = await post("/api/video-uploads", { action: "complete", token });
    await readApiJson(complete, "Finish transfer", "Could not finish the video transfer.");
  }
  options.onProgress?.(100);
  const response = await post(path, { ...options.fields, uploadToken: token });
  if (response.ok || response.status === 422) {
    if (key) {
      try { localStorage.removeItem(key); } catch { /* The staged object will still be removed. */ }
    }
    void post("/api/video-uploads", { action: "discard", token }).catch(() => undefined);
  }
  return response;
}
