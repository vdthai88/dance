import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { VideoUploadError } from "./video-upload";
import type { UploadedVideo } from "./video-upload";

// Decode one upload at a time in this process, with bounded decoder threads and
// output. Do not allocate whole-video buffers on small hosting instances.
let validating = false;
const waiting: Array<() => void> = [];
const timeoutMs = 120_000;
const sampleSeconds = 1;
const unavailable = "Video validation is unavailable. Your video has not been saved; please retry later.";
const timedOutMessage = "Checking this video took too long. It has not been saved. Try a shorter or lower-resolution clip.";
async function acquire() {
  if (validating) {
    if (waiting.length >= 3) throw new VideoUploadError("Video checks are busy. Your video has not been saved; please retry shortly.", 503);
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  validating = true;
}
function release() {
  const next = waiting.shift();
  if (next) next(); else validating = false;
}

function checkVideo(
  executable: string,
  video: UploadedVideo,
  deadline: number,
  sampleStart?: number,
): Promise<number> {
  const remaining = Math.ceil(deadline - performance.now());
  if (remaining <= 0) throw new VideoUploadError(timedOutMessage, 422);
  const scanning = sampleStart === undefined;
  // Use the primary video stream's timestamps to choose sample positions.
  // The demuxer still reads the input through EOF during the packet scan.
  const inputPosition = scanning ? [] : ["-ss", String(sampleStart)];
  const output = scanning
    ? ["-c", "copy"]
    : ["-map", "0:a?", "-t", String(sampleSeconds), "-threads", "1"];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
      "-max_alloc", "67108864", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1",
      "-err_detect", "explode", "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm",
      ...inputPosition, "-i", video.path,
      "-map", "0:v:0", ...output, "-sn", "-dn",
      "-progress", "pipe:1", "-nostats", "-f", "null", "-",
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    let launchFailed = false;
    let diagnostics = "";
    let progress = "";
    let frames = 0;
    let duration = 0;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, remaining);
    child.stderr.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4096); });
    child.stdout.on("data", (chunk: Buffer) => {
      const lines = (progress + chunk.toString()).split(/\r?\n/);
      progress = lines.pop()!.slice(-256);
      for (const line of lines) {
        if (line.startsWith("frame=")) frames = Math.max(frames, Number(line.slice(6)) || 0);
        if (line.startsWith("out_time_us=")) duration = Math.max(duration, (Number(line.slice(12)) || 0) / 1_000_000);
      }
    });
    child.once("error", () => { launchFailed = true; });
    child.once("close", (code) => {
      clearTimeout(timer);
      const phase = scanning ? "packet scan" : "playback sample";
      if (launchFailed) return reject(new VideoUploadError(unavailable, 503));
      if (timedOut) {
        console.warn("Video validation timed out:", { phase, sampleStart, frames, bytes: video.size, timeoutMs });
        return reject(new VideoUploadError(timedOutMessage, 422));
      }
      if (code !== 0 || (!scanning && frames === 0) || diagnostics.trim()) {
        console.warn("Video validation rejected upload:", { phase, sampleStart, code, frames, detail: diagnostics.slice(-1500) });
        return reject(new VideoUploadError("This video is damaged or could not be decoded. It has not been saved. Re-export it as MP4 with H.264 video and AAC audio, then try again.", 422));
      }
      resolve(duration);
    });
  });
}

/** Scan the container and decode short samples before permanent storage or database writes. */
export async function validateUploadedVideo(video: UploadedVideo): Promise<void> {
  const executable = process.env.FFMPEG_PATH || ffmpegPath;
  if (!executable) throw new VideoUploadError(unavailable, 503);
  const isDevelopment = process.env.NODE_ENV === "development";
  const queuedAt = performance.now();
  await acquire();
  try {
    const startedAt = performance.now();
    const queueMs = Math.round(startedAt - queuedAt);
    const deadline = startedAt + timeoutMs;
    if (isDevelopment) console.info("Video validation started:", { bytes: video.size, queueMs, timeoutMs });
    const duration = await checkVideo(executable, video, deadline);
    const lastStart = Math.max(0, duration - sampleSeconds);
    const starts = new Set([0, lastStart / 2, lastStart]);
    for (const start of starts) await checkVideo(executable, video, deadline, start);
    if (isDevelopment) console.info("Video validation completed:", { validationMs: Math.round(performance.now() - startedAt), queueMs, bytes: video.size, samples: starts.size });
  } finally { release(); }
}
