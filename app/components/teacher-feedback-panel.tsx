"use client";

import { useEffect, useRef, useState } from "react";
import type { TeacherFeedback } from "../lib/gemini-critique";

type Role = "student" | "teacher";
type SavedTeacherFeedback = { id: string; sessionId: string; model: string; feedback: TeacherFeedback; createdAt: string };

export function TeacherFeedbackPanel({ sessionId, role }: { sessionId: string | null; role: Role }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const lookupId = useRef(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedFor, setRecordedFor] = useState<string | null>(null);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [notes, setNotes] = useState<{ sessionId: string; entries: SavedTeacherFeedback[] } | null>(null);
  const [error, setError] = useState("");

  const savedEntries = notes?.sessionId === sessionId ? notes.entries : [];
  const currentRecording = recordedFor === sessionId ? recordedBlob : null;

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const requestId = ++lookupId.current;
    const form = new FormData();
    form.set("sessionId", sessionId);
    void fetch("/api/saved-teacher-feedback", { method: "POST", body: form })
      .then(async (response) => {
        const result = await response.json() as SavedTeacherFeedback[] | { error?: string };
        if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not load teacher notes.");
        if (active && requestId === lookupId.current) setNotes({ sessionId, entries: result as SavedTeacherFeedback[] });
      })
      .catch((caught) => { if (active && requestId === lookupId.current) setError(caught instanceof Error ? caught.message : "Could not load teacher notes."); });
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => () => { if (recordingUrl) URL.revokeObjectURL(recordingUrl); }, [recordingUrl]);

  useEffect(() => {
    if ((!sessionId || role === "student") && recorder.current?.state === "recording") recorder.current.stop();
  }, [role, sessionId]);

  async function startRecording() {
    setError("");
    if (!sessionId) { setError("Create or select a session before recording feedback."); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser does not support microphone recording. Try the current version of Chrome or Edge.");
      return;
    }
    const sessionAtStart = sessionId;
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const mediaRecorder = new MediaRecorder(microphone, mimeType ? { mimeType } : undefined);
      stream.current = microphone;
      recorder.current = mediaRecorder;
      chunks.current = [];
      mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.current.push(event.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        setRecordedBlob(blob);
        setRecordedFor(sessionAtStart);
        setRecordingUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(blob); });
        microphone.getTracks().forEach((track) => track.stop());
        stream.current = null;
        setIsRecording(false);
      };
      mediaRecorder.start(1000);
      setIsRecording(true);
      setRecordedBlob(null);
      setRecordedFor(null);
      setRecordingUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return ""; });
    } catch (caught) {
      setError(caught instanceof Error && caught.name === "NotAllowedError"
        ? "Microphone access was blocked. Allow microphone access for this site, then try again."
        : "The microphone could not start. Check that it is connected and available.");
    }
  }

  function stopRecording() { if (recorder.current?.state === "recording") recorder.current.stop(); }

  async function summarizeRecording() {
    if (!sessionId || !currentRecording || recordedFor !== sessionId) return;
    const sessionAtSubmit = sessionId;
    setIsSummarizing(true);
    setError("");
    try {
      const form = new FormData();
      form.set("sessionId", sessionAtSubmit);
      form.set("audio", currentRecording, `teacher-note.${currentRecording.type.includes("mp4") ? "mp4" : "webm"}`);
      const response = await fetch("/api/teacher-feedback", { method: "POST", body: form });
      const result = await response.json() as SavedTeacherFeedback | { error?: string };
      if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Gemini could not summarize this recording.");
      setNotes((previous) => ({ sessionId: sessionAtSubmit, entries: [result as SavedTeacherFeedback, ...(previous?.sessionId === sessionAtSubmit ? previous.entries : [])] }));
      setRecordedBlob(null);
      setRecordedFor(null);
      setRecordingUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return ""; });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gemini could not summarize this recording.");
    } finally { setIsSummarizing(false); }
  }

  return <section className="teacher-feedback-panel">
    {role === "teacher" && <div className="teacher-record-controls">
      <div className="teacher-panel-heading"><div><div className="eyebrow muted">SESSION COACHING</div><h3>Speak your feedback</h3></div><span className="sample-tag">MICROPHONE</span></div>
      <p>Record coaching for this practice session. Notes can refer to the whole session or to any video attached to it. Gemini turns your recording into action items; only the summary is saved locally.</p>
      {!sessionId && <p className="teacher-empty-state">Create or select a session first.</p>}
      <div className="teacher-record-actions">
        {!isRecording
          ? <button className="button button-dark" onClick={startRecording} disabled={!sessionId || isSummarizing}><span aria-hidden="true">🎙</span> Record feedback</button>
          : <button className="button button-recording" onClick={stopRecording}><span className="recording-dot"/> Stop recording</button>}
        {isRecording && <span className="recording-status">Recording… your microphone is active</span>}
      </div>
      {recordingUrl && <div className="teacher-audio-preview"><audio controls src={recordingUrl}/><button className="button button-dark" onClick={summarizeRecording} disabled={isSummarizing || !currentRecording}>{isSummarizing ? <><span className="spinner"/> Summarizing…</> : "Summarize into action items"}</button></div>}
    </div>}
    <div className="teacher-panel-heading student-notes-heading"><div><div className="eyebrow muted">{role === "student" ? "FROM YOUR TEACHER" : "SAVED SESSION NOTES"}</div><h3>Coaching notes</h3></div><span className="sample-tag">SESSION</span></div>
    {savedEntries.length > 0 ? <div className="teacher-saved-list">{savedEntries.map((entry) => <article className="teacher-saved-note" key={entry.id}>
      <div className="teacher-note-date">{new Date(entry.createdAt.replace(" ", "T") + (entry.createdAt.endsWith("Z") ? "" : "Z")).toLocaleString()}</div>
      <p className="teacher-note-summary">{entry.feedback.summary}</p>
      {entry.feedback.actionItems.length > 0 && <ul className="teacher-action-items">{entry.feedback.actionItems.map((item, index) => <li key={`${entry.id}-${index}`}><span className={`priority priority-${item.priority}`}>{item.priority}</span><span><strong>{item.title}</strong><br/>{item.details}</span></li>)}</ul>}
    </article>)}</div> : sessionId ? <p className="teacher-empty-state">{notes?.sessionId === sessionId ? "No teacher notes have been saved for this session yet." : "Loading session notes…"}</p> : role === "student" ? <p className="teacher-empty-state">Choose a session to view its teacher notes.</p> : null}
    {error && <p className="error-message" role="alert">{error}</p>}
  </section>;
}
