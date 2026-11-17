"use client";

import { useCallback, useEffect, useState } from "react";
import { readApiJson } from "../lib/api-response";
import type { LibraryVideo } from "../lib/video-library-types";

export function VideoLibrary({ refreshKey }: { refreshKey: number }) {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/replai-videos", { cache: "no-store", signal });
      const result = await readApiJson(response, "Video library");
      if (!Array.isArray(result)) throw new Error("Your video list could not be read. Try refreshing it.");
      if (!signal?.aborted) setVideos(result as LibraryVideo[]);
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "Your videos could not be loaded.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, refreshKey]);

  return <section className="video-library" aria-labelledby="video-library-heading">
    <div className="video-library-heading"><div><div className="eyebrow muted">YOUR VIDEO LIBRARY</div><h2 id="video-library-heading">Your uploaded videos</h2><p>Your latest 100 uploads and videos from your coaching sessions.</p></div><button className="toggle-button" type="button" disabled={loading} onClick={() => { void load(); }}>{loading ? "Loading..." : "Refresh list"}</button></div>
    {error && <p className="video-library-error" role="alert">{error}</p>}
    {!loading && !error && videos.length === 0 && <p className="video-library-empty">No saved videos yet. Choose a video above to add it to your library.</p>}
    <ul className="video-library-list">{videos.map((video) => <li key={video.id}>
      <div className="video-library-row"><div><strong>{video.filename}</strong><p><time dateTime={video.createdAt}>{new Date(video.createdAt).toLocaleString()}</time>{video.byteSize > 0 && <> · {(video.byteSize / (1024 * 1024)).toFixed(1)} MB</>}</p><span>{video.sessionName || "Personal ReplAI upload"}</span>{!video.available && <p>Original file unavailable. Upload this video again to play it.</p>}</div>
        <button className="toggle-button" type="button" disabled={!video.available} aria-expanded={playingId === video.id} onClick={() => { setError(""); setPlayingId((current) => current === video.id ? null : video.id); }}>{playingId === video.id ? "Close video" : "Play video"}</button></div>
      {playingId === video.id && <video className="video-library-player" controls playsInline preload="metadata" src={`/api/replai-videos/${encodeURIComponent(video.id)}/content`} aria-label={video.filename} onError={() => setError(`“${video.filename}” could not be played. The stored file may be unavailable or its format may not be supported by this browser.`)} />}
    </li>)}</ul>
  </section>;
}
