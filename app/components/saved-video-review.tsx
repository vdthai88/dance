"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { readApiJson } from "../lib/api-response";
import type { LibraryReview, LibraryVideo, LibraryVideoDetails } from "../lib/video-library-types";
import { CritiqueCard } from "./critique-card";

function ReviewPlayer({ video, review, pendingContent }: { video: LibraryVideo; review: LibraryReview | null; pendingContent?: ReactNode }) {
  const player = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [error, setError] = useState("");
  const displayedCritique = review?.comparison ? {
    ...review.critique,
    observations: review.critique.observations.map((note) => ({
      ...note, video: "new" as const,
      timestampSeconds: note.timestampSeconds === null || note.video === "new" ? note.timestampSeconds
        : Math.max(0, note.timestampSeconds - review.earlierSongStart + review.newerSongStart),
    })),
  } : review?.critique;
  function seek(seconds: number, target: "earlier" | "new" | "both" = "both") {
    const element = player.current;
    if (!element) return;
    const mapped = review?.comparison && target !== "new"
      ? seconds - review.earlierSongStart + review.newerSongStart
      : seconds;
    element.currentTime = Math.max(0, Math.min(mapped, Number.isFinite(element.duration) ? element.duration : mapped));
    void element.play().catch(() => setError("Playback could not start. Try the video's play button."));
  }
  return <div className="saved-review-player">
    <div className="saved-review-video-heading"><strong>{review?.comparison ? "Newer take" : "Video"}</strong><p>{video.filename}</p></div>
    <div className="saved-review-grid">
      <div className="saved-review-videos">
        <div>{video.available ? <video ref={player} controls playsInline preload="metadata" src={`/api/replai-videos/${encodeURIComponent(video.id)}/content`} onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onError={() => setError("This video could not be played. Try uploading it again.")} /> : <p>This saved take is no longer available.</p>}</div>
      </div>
      <div className="saved-review-feedback"><div className="saved-review-feedback-inner">
        {pendingContent || (review && displayedCritique ? <CritiqueCard critique={displayedCritique} currentTime={time} onSeek={seek} videoName={video.filename} title={review.comparison ? "AI COMPARISON & NEW FEEDBACK" : "AI VIDEO CRITIQUE"} /> : <p className="video-library-empty">No AI critique is saved for this video in your account yet.</p>)}
      </div></div>
    </div>
      {review?.comparison && <p>Compared with {review.earlierVideo?.filename ?? "the earlier take"}. The original critique stays with that video.</p>}
      {review?.comparison && <p>Song starts used: earlier {review.earlierSongStart.toFixed(2)}s; newer {review.newerSongStart.toFixed(2)}s.</p>}
      {error && <p className="video-library-error" role="alert">{error}</p>}
  </div>;
}

export function SavedVideoReview({ videoId, video, revision = "", pendingContent, onRequestCritique, critiqueRequestDisabled }: {
  videoId: string;
  video?: LibraryVideo;
  revision?: string;
  pendingContent?: ReactNode;
  onRequestCritique?: () => void;
  critiqueRequestDisabled?: boolean;
}) {
  const reviewSection = useRef<HTMLDivElement>(null);
  const hasPendingReview = Boolean(pendingContent);
  const [details, setDetails] = useState<LibraryVideoDetails | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [loadedRevision, setLoadedRevision] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/replai-videos/${encodeURIComponent(videoId)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => readApiJson(response, "Saved video review"))
      .then((result) => { if (!controller.signal.aborted) { setDetails(result as LibraryVideoDetails); setLoadedRevision(revision); setError(""); } })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The review could not be loaded."); });
    return () => controller.abort();
  }, [videoId, retry, revision]);
  useEffect(() => {
    if (!hasPendingReview) return;
    const frame = window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      reviewSection.current?.scrollIntoView({
        behavior: reduceMotion ? "instant" : "smooth",
        block: "start",
        inline: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasPendingReview, videoId]);
  const shownVideo = details?.video ?? video;
  if (!shownVideo) return <p role="status">Loading video and AI feedback...</p>;
  const reviews = details?.reviews ?? [];
  const review = reviews.find((item) => item.key === selectedKey) ?? reviews[0] ?? null;
  const loadingFeedback = !error && loadedRevision !== revision;
  const reviewStatus = pendingContent || (loadingFeedback ? <aside className="aside-card ai-feedback-status" role="status"><h3>Loading your AI feedback</h3><div className="ai-feedback-spinner" aria-hidden="true" /></aside> : null);
  return <div ref={reviewSection} className="saved-video-review" data-pending-review={hasPendingReview || undefined}>
    {error && <div role="alert"><p className="video-library-error">{error}</p><button className="toggle-button" type="button" onClick={() => { setError(""); setRetry((current) => current + 1); }}>Retry loading review</button></div>}
    {!reviewStatus && reviews.length > 1 && <label className="saved-review-selector">Saved feedback<select value={review?.key ?? ""} onChange={(event) => setSelectedKey(event.target.value)}>{reviews.map((item) => <option key={item.key} value={item.key}>{item.comparison ? "AI comparison" : "AI critique"} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>}
    {details && !error && !reviewStatus && onRequestCritique && !review?.comparison && !review?.critique.scores &&
      <button className="toggle-button" type="button" disabled={critiqueRequestDisabled} onClick={onRequestCritique}>
        {review ? "Get scored AI critique" : "Get AI critique"}
      </button>}
    <ReviewPlayer video={shownVideo} review={review} pendingContent={reviewStatus} />
  </div>;
}
