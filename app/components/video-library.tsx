"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readApiJson } from "../lib/api-response";
import type { LibraryVideo } from "../lib/video-library-types";

export function VideoLibrary({ refreshKey, busy = false, onCritiquesDeleted }: { refreshKey: number; busy?: boolean; onCritiquesDeleted?: () => void }) {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [videoToDelete, setVideoToDelete] = useState<LibraryVideo | null>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    setMessage("");
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

  function openDeleteDialog(video: LibraryVideo) {
    if (busy || deletingId || !video.canDelete) return;
    setError("");
    setVideoToDelete(video);
    deleteDialog.current?.showModal();
  }

  async function deleteVideo(video: LibraryVideo, deleteCritiques: boolean) {
    if (deletingId || !video.canDelete) return;
    setDeletingId(video.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/replai-videos/${encodeURIComponent(video.id)}?deleteCritiques=${deleteCritiques}`, { method: "DELETE" });
      if (!response.ok) await readApiJson(response, "Delete video");
      setPlayingId((current) => current === video.id ? null : current);
      setVideos((current) => current.filter((item) => item.id !== video.id));
      setMessage(deleteCritiques ? `"${video.filename}" and its AI critiques were deleted from your account.` : `"${video.filename}" was deleted. Its AI critiques were kept.`);
      if (deleteCritiques) onCritiquesDeleted?.();
      deleteDialog.current?.close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The video could not be deleted. Please try again.");
    } finally { setDeletingId(null); }
  }

  return <section className="video-library" aria-labelledby="video-library-heading">
    <div className="video-library-heading"><div><div className="eyebrow muted">YOUR VIDEO LIBRARY</div><h2 id="video-library-heading">Your uploaded videos</h2><p>Your latest 100 uploads and videos from your coaching sessions.</p></div><button className="toggle-button" type="button" disabled={loading || deletingId !== null} onClick={() => { void load(); }}>{loading ? "Loading..." : "Refresh list"}</button></div>
    {error && <p className="video-library-error" role="alert">{error}</p>}
    {message && <p className="video-library-message" role="status">{message}</p>}
    {!loading && !error && videos.length === 0 && <p className="video-library-empty">No saved videos yet. Choose a video above to add it to your library.</p>}
    <ul className="video-library-list">{videos.map((video) => <li key={video.id}>
      <div className="video-library-row"><div><strong>{video.filename}</strong><p><time dateTime={video.createdAt}>{new Date(video.createdAt).toLocaleString()}</time>{video.byteSize > 0 && <> · {(video.byteSize / (1024 * 1024)).toFixed(1)} MB</>}</p><span>{video.sessionName || "Personal ReplAI upload"}</span>{!video.available && <p>Original file unavailable. Upload this video again to play it.</p>}</div>
        <div className="video-library-actions"><button className="toggle-button" type="button" disabled={!video.available || deletingId === video.id} aria-expanded={playingId === video.id} onClick={() => { setError(""); setPlayingId((current) => current === video.id ? null : video.id); }}>{playingId === video.id ? "Close video" : "Play video"}</button>
          <button className="video-delete-button" type="button" disabled={busy || loading || deletingId !== null || !video.canDelete} title={video.canDelete ? `Delete ${video.filename}` : "Only the uploader can delete this session video"} aria-label={`Delete ${video.filename}`} aria-busy={deletingId === video.id} onClick={() => openDeleteDialog(video)}>
            {deletingId === video.id ? <span className="spinner" aria-hidden="true" /> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg>}
          </button></div></div>
      {playingId === video.id && <video className="video-library-player" controls playsInline preload="metadata" src={`/api/replai-videos/${encodeURIComponent(video.id)}/content`} aria-label={video.filename} onError={() => setError(`“${video.filename}” could not be played. The stored file may be unavailable or its format may not be supported by this browser.`)} />}
    </li>)}</ul>
    <dialog ref={deleteDialog} className="video-delete-dialog" aria-labelledby="video-delete-title" aria-describedby="video-delete-description" onClose={() => setVideoToDelete(null)} onCancel={(event) => { if (deletingId) event.preventDefault(); }}>
      <h2 id="video-delete-title">Delete video</h2>
      <p className="video-delete-filename">{videoToDelete?.filename}</p>
      <p id="video-delete-description">Choose what to permanently remove. Deleting critiques also removes your AI comparisons involving this video.</p>
      {error && <p className="video-library-error" role="alert">{error}</p>}
      {deletingId && <p role="status"><span className="spinner" aria-hidden="true" /> Deleting...</p>}
      <div className="video-delete-options">
        <button className="toggle-button" type="button" disabled={deletingId !== null} onClick={() => deleteDialog.current?.close()}>Cancel</button>
        <button className="toggle-button" type="button" disabled={deletingId !== null || !videoToDelete} onClick={() => { if (videoToDelete) void deleteVideo(videoToDelete, false); }}>Delete video only</button>
        <button className="button video-delete-all" type="button" disabled={deletingId !== null || !videoToDelete} onClick={() => { if (videoToDelete) void deleteVideo(videoToDelete, true); }}>Delete video and critiques</button>
      </div>
    </dialog>
  </section>;
}
