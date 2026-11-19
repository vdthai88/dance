"use client";

import { useId, useRef, useState } from "react";
import { readApiJson } from "../lib/api-response";
import type { ProTrial } from "../lib/pro-trial-types";

export function ProPreview({ trial, onStarted }: { trial?: ProTrial | null; onStarted?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [startedTrial, setStartedTrial] = useState<ProTrial | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const currentTrial = trial ?? startedTrial;
  async function startTrial() {
    dialog.current?.showModal();
    if (currentTrial || working) return;
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/account/pro-trial", { method: "POST" });
      const result = await readApiJson(response, "Start Pro trial") as { trial: ProTrial };
      if (!result.trial?.startedAt) throw new Error("Your trial start could not be confirmed. Please try again.");
      setStartedTrial(result.trial);
      onStarted?.();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Your Pro trial could not be started."); }
    finally { setWorking(false); }
  }
  return <>
    <button className="profile-pro-button" type="button" aria-haspopup="dialog" aria-controls={id} disabled={working} title={currentTrial ? "View your Pro trial" : "Start your Pro trial and add teacher coaching tools"} onClick={() => void startTrial()}>{working ? "Starting Pro..." : currentTrial ? "Pro trial" : "Try Pro now!"} <span aria-hidden="true">↗</span></button>
    <dialog ref={dialog} id={id} className="pro-preview-dialog" aria-labelledby={id + "-title"} aria-describedby={id + "-description"}>
      <button className="pro-preview-close" type="button" aria-label="Close Pro preview" onClick={() => dialog.current?.close()}>×</button>
      <span className="eyebrow muted">ONE DANCE PRO</span>
      <h2 id={id + "-title"}>{currentTrial ? "Your Pro trial has started." : "Bring your coaching together."}</h2>
      <p id={id + "-description"}>{currentTrial ? "Your teacher coaching tools are ready. Turn feedback into focused practice." : "With Pro, get access to coaching tools that turn feedback into focused practice."}</p>
      {working && <p role="status">Starting your Pro trial...</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {currentTrial && <p className="pro-preview-availability">Trial started: <time dateTime={currentTrial.startedAt}>{new Date(currentTrial.startedAt).toLocaleString()}</time>{currentTrial.endsAt && <><br/>Trial ends: <time dateTime={currentTrial.endsAt}>{new Date(currentTrial.endsAt).toLocaleString()}</time></>}</p>}
      <ul className="pro-preview-features">
        <li><strong>Coaching sessions</strong><span>Keep practice videos, teacher feedback, and AI critiques together in dated sessions.</span></li>
        <li><strong>Speak your feedback</strong><span>Teachers can record coaching notes and let AI summarize them into clear action items.</span></li>
        <li><strong>Keep the next steps clear</strong><span>Review saved notes and exercises, with teacher voice updates to add to or refine feedback.</span></li>
        <li><strong>A connected coaching space</strong><span>Connect students with their teachers and studios, and organize coaching by student and session.</span></li>
      </ul>
      <p className="pro-preview-availability">Teacher tools let you create sessions, record coaching, and share action items with connected students. Students can review feedback shared with them.</p>
      {error && <button className="button button-dark" type="button" disabled={working} onClick={() => void startTrial()}>Try again</button>}
      <button className="button button-dark" type="button" onClick={() => dialog.current?.close()}>Got it</button>
    </dialog>
  </>;
}
