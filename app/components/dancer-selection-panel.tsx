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
  const [frameTime, setFrameTime] = useState<{ requested: number; actual: number } | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const frameReady = frameTime?.requested === seconds && !previewError;
  const showBoxes = frameReady && Math.abs(frameTime.actual - detection.referenceSeconds) < 0.05;
  useEffect(() => {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.preload = "auto";
    const draw = () => {
      const node = canvas.current;
      const context = node?.getContext("2d");
      if (!node || !context || !video.videoWidth) return;
      node.width = 640;
      node.height = Math.round(640 * video.videoHeight / video.videoWidth);
      context.drawImage(video, 0, 0, node.width, node.height);
      setFrameTime({ requested: seconds, actual: video.currentTime });
      setPreviewError(false);
    };
    video.onloadeddata = () => { const target = Math.max(0, Math.min(seconds, Math.max(0, video.duration - 0.05))); if (target === 0) draw(); else video.currentTime = target; };
    video.onseeked = draw; video.onerror = () => setPreviewError(true);
    video.src = `/api/replai-videos/${encodeURIComponent(videoId)}/content`;
    return () => { video.onloadeddata = null; video.onseeked = null; video.onerror = null; video.removeAttribute("src"); video.load(); };
  }, [videoId, seconds]);
  function chooseCandidate(candidate: DancerDetection["candidates"][number]) {
    setSeconds(detection.referenceSeconds);
    setPoint(null);
    setDescription(candidate.description);
  }

  async function confirm() {
    setWorking(true); setError("");
    try {
      const location = point ? `Person at ${Math.round(point.x * 100)}% from the left and ${Math.round(point.y * 100)}% from the top of the reference frame. ` : "";
      const response = await fetch(`/api/replai-videos/${encodeURIComponent(videoId)}/dancer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: `${location}${description.trim()}`.trim().slice(0, 800), referenceSeconds: frameReady ? frameTime.actual : seconds }) });
      await readApiJson(response, "Choose dancer"); onChosen();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The dancer could not be selected."); }
    finally { setWorking(false); }
  }
  return <section className="dancer-selection-panel" aria-label={"Choose dancer in " + title}>
    <h3>Who should AI focus on?</h3><strong>{title}</strong><p>{detection.explanation}</p>
    <p>Tap the dancer in the frame or choose a suggested dancer below. You can also add a clothing description.</p>
    <div className="dancer-reference-frame-wrap">
      <canvas ref={canvas} className="dancer-reference-frame" aria-label={"Reference frame for " + title} onClick={(event) => {
        if (!frameReady || working) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        setPoint({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height });
        setDescription("");
      }} />
      {showBoxes && detection.candidates.map((candidate, index) => candidate.box && <button key={`box-${index}`} className={`dancer-frame-target${description === candidate.description ? " selected" : ""}`} type="button" disabled={working} aria-label={`Choose dancer ${index + 1}: ${candidate.description}`} aria-pressed={description === candidate.description} style={{ left: `${candidate.box.x * 100}%`, top: `${candidate.box.y * 100}%`, width: `${candidate.box.width * 100}%`, height: `${candidate.box.height * 100}%` }} onClick={() => chooseCandidate(candidate)}><span>{index + 1}</span></button>)}
      {point && frameReady && <span className="dancer-frame-point" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} aria-hidden="true" />}
    </div>
    {previewError && <p>Use the main video to identify the dancer; the reference frame could not be loaded.</p>}
    <div className="dancer-candidates">{detection.candidates.map((candidate, index) => <button className={description === candidate.description ? "toggle-button selected" : "toggle-button"} type="button" key={index} disabled={working} aria-pressed={description === candidate.description} onClick={() => chooseCandidate(candidate)}>{candidate.box ? `Dancer ${index + 1}: ${candidate.description}` : candidate.description}</button>)}</div>
    <label>Describe or refine the dancer to review<textarea value={description} maxLength={800} rows={3} disabled={working} placeholder="For example: wearing shorts and a dark cropped top, on the left." onChange={(event) => setDescription(event.target.value)} /></label>
    <label>Reference time in seconds<input type="number" min="0" step="0.1" value={Number.isFinite(seconds) ? seconds : ""} disabled={working} onChange={(event) => { setPoint(null); setFrameTime(null); setSeconds(event.currentTarget.valueAsNumber); }} /></label>
    {error && <p className="error-message" role="alert">{error}</p>}
    <button className="button button-dark" type="button" disabled={working || (!description.trim() && !(point && frameReady)) || !Number.isFinite(seconds) || seconds < 0} onClick={() => void confirm()}>{working ? "Saving dancer..." : "Use this dancer"}</button>
  </section>;
}
