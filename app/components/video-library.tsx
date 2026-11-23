"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { readApiJson } from "../lib/api-response";
import type { LibraryVideo, VideoGroup } from "../lib/video-library-types";
import { SavedVideoReview } from "./saved-video-review";
import { ReplaiName } from "./replai-name";

type Props = {
  refreshKey: number;
  busy?: boolean;
  focusVideoId?: string | null;
  onCritiquesDeleted?: () => void;
  onCompare?: (video: LibraryVideo, file: File) => Promise<void>;
  onUpload?: (file: File, groupId: string) => void;
  onReview?: (video: LibraryVideo) => Promise<void>;
  children?: ReactNode;
  pendingReview?: { videoId: string; content: ReactNode } | null;
};

export function VideoLibrary({ refreshKey, busy = false, focusVideoId, onCritiquesDeleted, onCompare, onUpload, onReview, children, pendingReview }: Props) {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [groups, setGroups] = useState<VideoGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [expandedVideoIds, setExpandedVideoIds] = useState<Set<string>>(() => new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [videoToDelete, setVideoToDelete] = useState<LibraryVideo | null>(null);
  const [groupName, setGroupName] = useState("");
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [renamedGroup, setRenamedGroup] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [reviewVersion, setReviewVersion] = useState(0);
  const focusedReview = useRef("");
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const newerTakeInputs = useRef(new Map<string, HTMLInputElement>());

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(""); setMessage("");
    try {
      const [result, groupResult] = await Promise.all([
        fetch("/api/replai-videos", { cache: "no-store", signal }).then((response) => readApiJson(response, "Video library")),
        fetch("/api/replai-video-groups", { cache: "no-store", signal }).then((response) => readApiJson(response, "Video groups")),
      ]);
      if (!Array.isArray(result) || !Array.isArray(groupResult)) throw new Error("Your video list could not be read. Try refreshing it.");
      if (signal?.aborted) return;
      const items = result as LibraryVideo[];
      const loadedGroups = groupResult as VideoGroup[];
      const focusKey = String(focusVideoId) + "-" + refreshKey;
      const target = items.find((video) => video.id === focusVideoId);
      if (target && focusedReview.current !== focusKey) {
        setExpandedVideoIds((current) => new Set(current).add(target.id));
        const group = loadedGroups.find((item) => item.id === target.groupId);
        if (group?.collapsed) {
          const response = await fetch("/api/replai-video-groups/" + encodeURIComponent(group.id), {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ collapsed: false }), signal,
          });
          await readApiJson(response, "Open completed review");
          group.collapsed = false;
        }
        focusedReview.current = focusKey;
      }
      if (!signal?.aborted) { setVideos(items); setGroups(loadedGroups); setReviewVersion((current) => current + 1); }
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "Your videos could not be loaded.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [focusVideoId, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  async function createGroup() {
    if (!groupName.trim()) return;
    setUpdating("new"); setError("");
    try {
      const response = await fetch("/api/replai-video-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: groupName }) });
      const group = await readApiJson(response, "Create video group") as VideoGroup;
      setGroups((current) => [group, ...current]); setGroupName("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The group could not be created."); }
    finally { setUpdating(null); }
  }

  async function saveGroup(group: VideoGroup, changes: { name?: string; collapsed?: boolean }) {
    setUpdating(group.id); setError("");
    try {
      if (group.id.startsWith("ungrouped:")) {
        const videoId = group.id.slice("ungrouped:".length);
        const created = await fetch("/api/replai-video-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: changes.name ?? group.name }) });
        const result = await readApiJson(created, "Create video group") as VideoGroup;
        const moved = await fetch("/api/replai-videos/" + encodeURIComponent(videoId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: result.id }) });
        if (!moved.ok) await readApiJson(moved, "Group video");
        setGroups((current) => [result, ...current]);
        setVideos((current) => current.map((video) => video.id === videoId ? { ...video, groupId: result.id } : video));
        if (changes.collapsed !== undefined) {
          const response = await fetch("/api/replai-video-groups/" + encodeURIComponent(result.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collapsed: changes.collapsed }) });
          const updated = await readApiJson(response, "Update video group") as VideoGroup;
          setGroups((current) => current.map((item) => item.id === result.id ? updated : item));
        }
        setEditingGroup(null);
        return;
      }
      const response = await fetch("/api/replai-video-groups/" + encodeURIComponent(group.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      const result = await readApiJson(response, "Update video group") as VideoGroup;
      setGroups((current) => current.map((item) => item.id === group.id ? result : item));
      setEditingGroup(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The group could not be updated."); }
    finally { setUpdating(null); }
  }


  async function compareVideo(video: LibraryVideo, file: File) {
    if (!onCompare) return;
    setUpdating(video.id); setError("");
    try {
      await onCompare(video, file);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The comparison could not start."); }
    finally { setUpdating(null); }
  }

  function openDeleteDialog(video: LibraryVideo) {
    if (busy || deletingId || !video.canDelete) return;
    setError(""); setVideoToDelete(video); deleteDialog.current?.showModal();
  }

  async function deleteVideo(video: LibraryVideo, deleteCritiques: boolean) {
    if (deletingId || !video.canDelete) return;
    setDeletingId(video.id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/replai-videos/" + encodeURIComponent(video.id) + "?deleteCritiques=" + deleteCritiques, { method: "DELETE" });
      if (!response.ok) await readApiJson(response, "Delete video");
      setExpandedVideoIds((current) => { const next = new Set(current); next.delete(video.id); return next; });
      setVideos((current) => current.filter((item) => item.id !== video.id));
      try {
        const response = await fetch("/api/replai-video-groups", { cache: "no-store" });
        const remaining = await readApiJson(response, "Refresh video groups") as VideoGroup[];
        setGroups(remaining);
      } catch { setError("The video was deleted. Refresh the list to update its groups."); }
      setReviewVersion((current) => current + 1);
      setMessage('"' + video.filename + '" was deleted.' + (deleteCritiques ? " Its AI critiques were deleted from your account." : " Its AI critiques were kept."));
      if (deleteCritiques) onCritiquesDeleted?.();
      deleteDialog.current?.close();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The video could not be deleted. Please try again."); }
    finally { setDeletingId(null); }
  }

  function renderVideo(video: LibraryVideo) {
    return <li key={video.id}>
      <div className="video-library-row"><div><strong>{video.filename}</strong><p>Upload date: <time dateTime={video.createdAt}>{new Date(video.createdAt).toLocaleString()}</time>{video.byteSize > 0 && <> · {(video.byteSize / (1024 * 1024)).toFixed(1)} MB</>}</p>{!video.available && <p>Original file unavailable. Upload this video again to restore playback.</p>}</div>
        <div className="video-library-actions"><button className="toggle-button" type="button" disabled={deletingId === video.id} aria-expanded={expandedVideoIds.has(video.id)} onClick={() => { setError(""); setExpandedVideoIds((current) => { const next = new Set(current); if (next.has(video.id)) next.delete(video.id); else next.add(video.id); return next; }); }}>{expandedVideoIds.has(video.id) ? "Close review" : "Video & critiques"}</button>
          {onReview && video.available && <button className="video-review-button" type="button" disabled={busy || loading || updating !== null || deletingId !== null} title="Choose dancer for AI review" aria-label={`Choose dancer for AI review for ${video.filename}`} onClick={() => { setUpdating(video.id); void onReview(video).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "The AI review could not start.")).finally(() => setUpdating(null)); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 15Z" /></svg></button>}
          {video.available && <a className="video-download-button" href={`/api/replai-videos/${encodeURIComponent(video.id)}/content?download=1`} download={video.filename} title={`Download ${video.filename}`} aria-label={`Download ${video.filename}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg></a>}
          <button className="video-delete-button" type="button" disabled={busy || loading || deletingId !== null || !video.canDelete} title={video.canDelete ? "Delete " + video.filename : "Only the uploader can delete this session video"} aria-label={"Delete " + video.filename} aria-busy={deletingId === video.id} onClick={() => openDeleteDialog(video)}>
            {deletingId === video.id ? <span className="spinner" aria-hidden="true" /> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg>}
          </button></div></div>
      {expandedVideoIds.has(video.id) && <SavedVideoReview key={video.id} videoId={video.id} video={video} revision={refreshKey + "-" + reviewVersion} pendingContent={pendingReview?.videoId === video.id ? pendingReview.content : null} />}
    </li>;
  }

  const ungrouped = videos.filter((video) => !video.groupId || !groups.some((group) => group.id === video.groupId));
  const displayedGroups = [...groups, ...ungrouped.map((video) => ({ id: "ungrouped:" + video.id, name: video.filename.slice(0, 100), collapsed: false }))];
  return <section className="video-library" aria-labelledby="video-library-heading">
    <div className="video-library-heading"><div><h2 id="video-library-heading"><ReplaiName /> Video Library</h2><p>Saved videos, AI critiques, and comparisons. Organize your latest 100 uploads into groups.</p></div><button className="toggle-button" type="button" disabled={loading || deletingId !== null} onClick={() => { void load(); }}>{loading ? "Loading..." : "Refresh list"}</button></div>
    {children && <div className="library-upload-area">{children}</div>}
    {error && <p className="video-library-error" role="alert">{error}</p>}
    {message && <p className="video-library-message" role="status">{message}</p>}
    {!loading && !error && videos.length === 0 && <p className="video-library-empty">No saved videos yet. Choose a video above to add it to your library.</p>}
    {displayedGroups.map((group) => {
      const members = (group.id.startsWith("ungrouped:") ? ungrouped.filter((video) => "ungrouped:" + video.id === group.id) : videos.filter((video) => video.groupId === group.id))
        .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt) || second.id.localeCompare(first.id));
      const comparisonVideo = members.find((video) => video.available);
      const cannotAddTake = busy || loading || updating !== null || deletingId !== null || (comparisonVideo ? !onCompare : !onUpload);
      return <section className="library-group" key={group.id}>
        <div className="library-group-heading"><button className="library-group-toggle" type="button" disabled={updating !== null} aria-expanded={!group.collapsed} aria-controls={"video-group-" + group.id} title="Double-click to rename group" data-tooltip="Double-click to rename group" onClick={(event) => { if (event.detail === 2) { event.preventDefault(); setEditingGroup(group.id); setRenamedGroup(group.name); return; } void saveGroup(group, { collapsed: !group.collapsed }); }}><span aria-hidden="true">{group.collapsed ? "\u25b8" : "\u25be"}</span><strong>{group.name}</strong><small>{members.length} {members.length === 1 ? "video" : "videos"}</small></button>
          <div className="library-group-actions">
            {(onCompare || onUpload) && <>
              <button className="button-outline library-newer-take" type="button" disabled={cannotAddTake} title={comparisonVideo ? `Compare with ${comparisonVideo.filename}` : `Upload the first video to ${group.name}`} onClick={() => newerTakeInputs.current.get(group.id)?.click()}>{comparisonVideo ? "Add newer take" : "Upload video"}</button>
              <input ref={(element) => { if (element) newerTakeInputs.current.set(group.id, element); else newerTakeInputs.current.delete(group.id); }} className="visually-hidden" type="file" accept="video/*" aria-label={(comparisonVideo ? "Add newer take to " : "Upload video to ") + group.name} disabled={cannotAddTake} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (!file) return; if (comparisonVideo) void compareVideo(comparisonVideo, file); else onUpload?.(file, group.id); }} />
            </>}
          </div></div>
        {editingGroup === group.id && <form className="library-group-inline-edit" onSubmit={(event) => { event.preventDefault(); if (renamedGroup.trim()) void saveGroup(group, { name: renamedGroup }); }}><input autoFocus value={renamedGroup} onChange={(event) => setRenamedGroup(event.target.value)} onBlur={() => { if (renamedGroup.trim()) void saveGroup(group, { name: renamedGroup }); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditingGroup(null); setRenamedGroup(""); } }} maxLength={100} aria-label={`Rename ${group.name}`} required /></form>}
        <div id={"video-group-" + group.id} hidden={group.collapsed}>{!group.collapsed && (members.length ? <ul className="video-library-list">{members.map(renderVideo)}</ul> : <p className="video-library-empty">Use Upload video to add the first take to this group and get AI feedback.</p>)}</div>
      </section>;
    })}
    <form className="library-create-group" onSubmit={(event) => { event.preventDefault(); void createGroup(); }}><label>New group<input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Orange Coloured Sky" maxLength={100} required /></label><button className="toggle-button" type="submit" disabled={updating !== null || !groupName.trim()}>Create group</button></form>
    <dialog ref={deleteDialog} className="video-delete-dialog" aria-labelledby="video-delete-title" aria-describedby="video-delete-description" onClose={() => setVideoToDelete(null)} onCancel={(event) => { if (deletingId) event.preventDefault(); }}>
      <h2 id="video-delete-title">Delete video</h2><p className="video-delete-filename">{videoToDelete?.filename}</p>
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
