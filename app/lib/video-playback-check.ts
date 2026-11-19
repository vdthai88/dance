/** Check local playback before uploading. This never sends the file anywhere. */
export function checkVideoPlayback(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const message = "This video could not be played. It has not been saved. Re-export it as MP4 with H.264 video and AAC audio, then try again.";
    let finished = false;
    let sample = 0;
    let positions: number[] = [];
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      video.onloadeddata = null; video.onseeked = null; video.onerror = null;
      video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error("Playback could not be verified in time. Your video has not been saved. Try a shorter clip or re-export it as MP4.")), 20000);
    const next = () => {
      if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return finish(new Error(message));
      if (sample >= positions.length) return finish();
      video.currentTime = positions[sample++];
    };
    video.muted = true; video.playsInline = true; video.preload = "auto";
    video.onerror = () => finish(new Error(message));
    video.onloadeddata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return finish(new Error(message));
      positions = [video.duration / 2, Math.max(0, video.duration - Math.min(0.1, video.duration / 4))];
      next();
    };
    video.onseeked = next;
    video.src = url;
    video.load();
  });
}
