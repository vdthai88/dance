"use client";

import { useEffect, useRef, useState } from "react";
import type { TeacherFeedback } from "../lib/gemini-critique";
import { microphoneRecordingError } from "../lib/microphone-recording";

type Role = "student" | "teacher";
type SavedTeacherFeedback = { id: string; sessionId: string; model: string; feedback: TeacherFeedback; createdAt: string };

export function TeacherFeedbackPanel({ sessionId, role }: { sessionId: string | null; role: Role }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const lookupId = useRef(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [recordingEditId, setRecordingEditId] = useState<string | null>(null);
  const [notes, setNotes] = useState<{ sessionId: string; entries: SavedTeacherFeedback[] } | null>(null);
  const [error, setError] = useState("");
  const savedEntries = notes?.sessionId === sessionId ? notes.entries : [];

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const requestId = ++lookupId.current;
    const form = new FormData();
    form.set("sessionId", sessionId);
    void fetch("/api/saved-teacher-feedback", { method: "POST", body: form, cache: "no-store" })
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

  useEffect(() => {
    if ((!sessionId || role === "student") && recorder.current?.state === "recording") recorder.current.stop();
  }, [role, sessionId]);

  async function startRecording(editing?: SavedTeacherFeedback) {
    setError("");
    if (!sessionId) { setError("Create or select a session before recording feedback."); return; }
    const recordingError = microphoneRecordingError({
      secureContext: window.isSecureContext,
      microphoneAvailable: Boolean(navigator.mediaDevices?.getUserMedia),
      recorderAvailable: typeof MediaRecorder !== "undefined",
    });
    if (recordingError) { setError(recordingError); return; }
    const sessionAtStart = sessionId;
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = microphone;
      const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type));
      const mediaRecorder = new MediaRecorder(microphone, mimeType ? { mimeType } : undefined);
      stream.current = microphone; recorder.current = mediaRecorder; chunks.current = [];
      mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.current.push(event.data); };
      mediaRecorder.onstop = () => {
        const recordingType = mediaRecorder.mimeType || chunks.current.find((chunk) => chunk.type)?.type || mimeType;
        const recording = new Blob(chunks.current, { type: recordingType });
        microphone.getTracks().forEach((track) => track.stop()); stream.current = null; setIsRecording(false);
        if (!recording.size || !recordingType) { setRecordingEditId(null); setError("No readable audio was recorded. Allow microphone access and try recording again."); return; }
        if (editing) void reviseRecording(recording, editing); else void summarizeRecording(recording, sessionAtStart);
      };
      mediaRecorder.start(1000);
      setRecordingEditId(editing?.id ?? null);
      setIsRecording(true);
    } catch (caught) {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null; recorder.current = null;
      setError(caught instanceof Error && caught.name === "NotAllowedError" ? "Microphone access was blocked. Allow microphone access for this site, then try again." : "The microphone could not start. Check that it is connected and available.");
    }
  }

  function stopRecording() { if (recorder.current?.state === "recording") recorder.current.stop(); }

  async function summarizeRecording(recording: Blob, sessionAtSubmit: string) {
    setIsSummarizing(true); setError("");
    try {
      const form = new FormData(); form.set("sessionId", sessionAtSubmit); form.set("audio", recording, `teacher-note.${recording.type.includes("mp4") ? "mp4" : "webm"}`);
      const response = await fetch("/api/teacher-feedback", { method: "POST", body: form });
      const result = await response.json() as SavedTeacherFeedback | { error?: string };
      if (!response.ok) throw new Error("error" in result && result.error ? result.error : "AI could not summarize this recording.");
      setNotes((previous) => ({ sessionId: sessionAtSubmit, entries: [result as SavedTeacherFeedback, ...(previous?.sessionId === sessionAtSubmit ? previous.entries : [])] }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "AI could not summarize this recording."); }
    finally { setIsSummarizing(false); setRecordingEditId(null); }
  }

  async function reviseRecording(recording: Blob, entry: SavedTeacherFeedback) {
    setIsSummarizing(true); setError("");
    try {
      const form = new FormData(); form.set("audio", recording, `teacher-note.${recording.type.includes("mp4") ? "mp4" : "webm"}`);
      const response = await fetch(`/api/session-teacher-feedback/${encodeURIComponent(entry.id)}/recording`, { method: "POST", body: form });
      const result = await response.json() as SavedTeacherFeedback | { error?: string };
      if (!response.ok) throw new Error("error" in result && result.error ? result.error : "AI could not update this coaching note.");
      setNotes((previous) => previous?.sessionId === entry.sessionId ? { ...previous, entries: previous.entries.map((item) => item.id === entry.id ? result as SavedTeacherFeedback : item) } : previous);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "AI could not update this coaching note."); }
    finally { setIsSummarizing(false); setRecordingEditId(null); }
  }

  async function deleteNote(entry: SavedTeacherFeedback) {
    if (!window.confirm("Delete this coaching note? This cannot be undone.")) return;
    setIsSummarizing(true); setError("");
    try {
      const response = await fetch(`/api/session-teacher-feedback/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "Could not delete this coaching note.");
      }
      setNotes((previous) => previous?.sessionId === entry.sessionId ? { ...previous, entries: previous.entries.filter((item) => item.id !== entry.id) } : previous);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete this coaching note."); }
    finally { setIsSummarizing(false); }
  }

  function noteActions(entry: SavedTeacherFeedback) {
    const isUpdatingThisNote = recordingEditId === entry.id;
    return <div className="note-actions">{isUpdatingThisNote
      ? isRecording
        ? <button className="note-action note-action-stop" type="button" title="Stop and update this note" aria-label="Stop and update this note" onClick={stopRecording}>■</button>
        : <button className="note-action note-action-processing" type="button" title="Updating coaching note" aria-label="Updating coaching note" disabled><span className="spinner"/></button>
      : <button className="note-action" type="button" title="Record an update to this note" aria-label="Record an update to this note" onClick={() => void startRecording(entry)} disabled={isRecording || isSummarizing}>✎</button>}
      <button className="note-action note-action-delete" type="button" title="Delete coaching note" aria-label="Delete coaching note" onClick={() => void deleteNote(entry)} disabled={isRecording || isSummarizing}>🗑</button>
    </div>;
  }

  return <section className="teacher-feedback-panel">
    {role === "teacher" && <div className="teacher-record-controls"><div className="teacher-panel-heading"><div><div className="eyebrow muted">SESSION COACHING</div><h3>Speak your feedback</h3></div><span className="sample-tag">MICROPHONE</span></div><p>Record coaching for this practice session. When you stop, AI saves a structured coaching note. Use the pencil beside a note to record instructions that add to, revise, or replace it.</p>{!sessionId && <p className="teacher-empty-state">Create or select a session first.</p>}<div className="teacher-record-actions">{!isRecording ? <button className="button button-dark" onClick={() => void startRecording()} disabled={!sessionId || isSummarizing}><span aria-hidden="true">🎙</span> Record feedback</button> : <button className="button button-recording" onClick={stopRecording}><span className="recording-dot"/> {recordingEditId ? "Stop and update note" : "Stop recording"}</button>}{isRecording && <span className="recording-status">{recordingEditId ? "Recording instructions for this note..." : "Recording... your microphone is active"}</span>}</div>{isSummarizing && <p className="teacher-empty-state"><span className="spinner"/> {recordingEditId ? "Updating and saving this coaching note..." : "Summarizing and saving your coaching notes..."}</p>}</div>}
    <div className="teacher-panel-heading student-notes-heading"><div><div className="eyebrow muted">{role === "student" ? "FROM YOUR TEACHER" : "SAVED SESSION NOTES"}</div><h3>Coaching notes</h3></div><span className="sample-tag">SESSION</span></div>
    {savedEntries.length > 0 ? <div className="teacher-saved-list">{savedEntries.map((entry) => <article className="teacher-saved-note" key={entry.id}><div className="teacher-note-top"><div className="teacher-note-date">{new Date(entry.createdAt.replace(" ", "T") + (entry.createdAt.endsWith("Z") ? "" : "Z")).toLocaleString()}</div>{role === "teacher" && noteActions(entry)}</div><p className="teacher-note-summary">{entry.feedback.summary}</p>{entry.feedback.actionItems.length > 0 && <ul className="teacher-action-items">{entry.feedback.actionItems.map((item, index) => <li key={`${entry.id}-${index}`}><span className={`priority priority-${item.priority}`}>{item.priority}</span><span><strong>{item.title}</strong><br/>{item.details}</span></li>)}</ul>}</article>)}</div> : sessionId ? <p className="teacher-empty-state">{notes?.sessionId === sessionId ? "No teacher notes have been saved for this session yet." : "Loading session notes..."}</p> : role === "student" ? <p className="teacher-empty-state">Choose a session to view its teacher notes.</p> : null}
    {error && <p className="error-message" role="alert">{error}</p>}
  </section>;
}
