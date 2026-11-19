import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { VideoUploadError } from "./video-upload";
import type { UploadedVideo } from "./video-upload";

// Decode one upload at a time in this process, with bounded decoder threads and
// output. Do not allocate whole-video buffers on small hosting instances.
let validating = false;
const waiting: Array<() => void> = [];
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

/** Fully decode the temporary upload before permanent storage or database writes. */
export async function validateUploadedVideo(video: UploadedVideo): Promise<void> {
  const executable = process.env.FFMPEG_PATH || ffmpegPath;
  if (!executable) throw new VideoUploadError("Video validation is unavailable. Your video has not been saved; please retry later.", 503);
  await acquire();
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
        "-max_alloc", "67108864", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1",
        "-err_detect", "explode", "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm", "-i", video.path,
        "-map", "0:v:0", "-map", "0:a?", "-sn", "-dn", "-threads", "1",
        "-progress", "pipe:1", "-nostats", "-f", "null", "-",
      ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let timedOut = false;
      let launchFailed = false;
      let diagnostics = "";
      let progress = "";
      let frames = 0;
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 60000);
      child.stderr.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4096); });
      child.stdout.on("data", (chunk: Buffer) => {
        progress += chunk.toString();
        const lines = progress.split(/\r?\n/);
        progress = lines.pop()!.slice(-256);
        for (const line of lines) if (line.startsWith("frame=")) frames = Math.max(frames, Number(line.slice(6)) || 0);
      });
      child.once("error", () => { launchFailed = true; });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (launchFailed) return reject(new VideoUploadError("Video validation is unavailable. Your video has not been saved; please retry later.", 503));
        if (timedOut) return reject(new VideoUploadError("Checking this video took too long. It has not been saved. Try a shorter or lower-resolution clip.", 422));
        if (code !== 0 || frames === 0 || diagnostics.trim()) {
          console.warn("Video validation rejected upload:", { code, frames, detail: diagnostics.slice(-1500) });
          return reject(new VideoUploadError("This video is damaged or could not be decoded. It has not been saved. Re-export it as MP4 with H.264 video and AAC audio, then try again.", 422));
        }
        resolve();
      });
    });
  } finally { release(); }
}
