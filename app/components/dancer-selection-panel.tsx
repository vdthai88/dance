"use client";
import { useEffect, useRef, useState } from "react";
import type { DancerDetection } from "../lib/dancer-selection";
import { readApiJson } from "../lib/api-response";

export function DancerSelectionPanel({ videoId, title, detection, onChosen }: { videoId: string; title: string; detection: DancerDetection; onChosen: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [description, setDescription] = useState("");
  const [seconds, setSeconds] = useState(detection.referenceSeconds);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => {
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.preload = "auto";
    const draw = () => { if (!canvas.current || !video.videoWidth) return; const node = canvas.current; node.width = 640; node.height = Math.round(640 * video.videoHeight / video.videoWidth); node.getContext("2d")?.drawImage(video, 0, 0, node.width, node.height); };
    video.onloadeddata = () => { const target = Math.max(0, Math.min(seconds, Math.max(0, video.duration - 0.05))); if (target === 0) draw(); else video.currentTime = target; };
    video.onseeked = draw; video.onerror = () => setPreviewError(true);
    video.src = `/api/replai-videos/${encodeURIComponent(videoId)}/content`;
    return () => { video.onloadeddata = null; video.onseeked = null; video.onerror = null; video.removeAttribute("src"); video.load(); };
  }, [videoId, seconds]);
  async function confirm() {
    setWorking(true); setError("");
    try {
      const response = await fetch(`/api/replai-videos/${encodeURIComponent(videoId)}/dancer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description, referenceSeconds: seconds }) });
      await readApiJson(response, "Choose dancer"); onChosen();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The dancer could not be selected."); }
    finally { setWorking(false); }
  }
  return <section className="dancer-selection-panel" aria-label={"Choose dancer in " + title}>
    <h3>Who should AI focus on?</h3><strong>{title}</strong><p>{detection.explanation}</p>
    <p>Choose the dancer using clothing and position in this reference frame. Reflections are not additional people.</p>
    <canvas ref={canvas} className="dancer-reference-frame" aria-label={"Reference frame for " + title} />
    {previewError && <p>Use the main video to identify the dancer; the reference frame could not be loaded.</p>}
    <div className="dancer-candidates">{detection.candidates.map((candidate, index) => <button className={description === candidate.description ? "toggle-button selected" : "toggle-button"} type="button" key={index} disabled={working} aria-pressed={description === candidate.description} onClick={() => setDescription(candidate.description)}>{candidate.description}</button>)}</div>
    <label>Describe or refine the dancer to review<textarea value={description} maxLength={800} rows={3} disabled={working} placeholder="For example: wearing shorts and a dark cropped top, on the left." onChange={(event) => setDescription(event.target.value)} /></label>
    <label>Reference time in seconds<input type="number" min="0" step="0.1" value={Number.isFinite(seconds) ? seconds : ""} disabled={working} onChange={(event) => setSeconds(event.currentTarget.valueAsNumber)} /></label>
    {error && <p className="error-message" role="alert">{error}</p>}
    <button className="button button-dark" type="button" disabled={working || !description.trim() || !Number.isFinite(seconds) || seconds < 0} onClick={() => void confirm()}>{working ? "Saving dancer..." : "Use this dancer"}</button>
  </section>;
}
