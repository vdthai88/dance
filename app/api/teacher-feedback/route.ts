import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import {
  isTeacherFeedback,
  TEACHER_FEEDBACK_PROMPT,
  teacherFeedbackSchema,
} from "../../lib/gemini-critique";
import { canAccessSession, getSessionSnapshot, saveSessionTeacherFeedback } from "../../lib/session-store";

export const runtime = "nodejs";
export const maxDuration = 120;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_AUDIO_BYTES = 14 * 1024 * 1024;
const AUDIO_MIME_TYPES = new Set([
  "audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg", "audio/aac", "audio/m4a",
]);

type GeminiInteraction = {
  status?: string;
  output_text?: string;
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Record a short teacher note before summarizing." }, { status: 400 });
  const sessionId = form.get("sessionId");
  const videoName = form.get("videoName");
  const audio = form.get("audio");
  if (typeof sessionId !== "string" || !sessionId) return NextResponse.json({ error: "Choose a practice session before recording teacher feedback." }, { status: 400 });
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "Record a short teacher note before summarizing." }, { status: 400 });
  }
  const mimeType = audio.type.split(";")[0].toLowerCase();
  if (!AUDIO_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "This browser recorded an unsupported audio format. Try recording again in Chrome or Edge." }, { status: 415 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "This recording is too large. Keep teacher notes under about 10 minutes and record again." }, { status: 413 });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Add GEMINI_API_KEY to dance/.env.local, then restart the dev server." }, { status: 503 });

  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to save teacher feedback." }, { status: 401 });
    if (!canAccessSession(user.id, sessionId, true)) return NextResponse.json({ error: "You do not have permission to add feedback to this session." }, { status: 403 });
    const session = getSessionSnapshot(sessionId);
    if (!session) return NextResponse.json({ error: "Practice session not found. Select the session again." }, { status: 404 });
    const bytes = Buffer.from(await audio.arrayBuffer());
    const response = await fetch(`${GEMINI_BASE}/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [
          { type: "text", text: `${TEACHER_FEEDBACK_PROMPT}\nThe teacher is giving feedback during a practice session for ${session.session.studentName} on ${session.session.sessionDate} at ${session.session.location}.${typeof videoName === "string" && videoName ? ` The session includes a video named "${videoName}"; the feedback may refer to the session generally or to that video.` : " The session may not have a video attached; summarize the spoken coaching at the session level."} Summarize the spoken coaching into practical action items.` },
          { type: "audio", data: bytes.toString("base64"), mime_type: mimeType },
        ],
        response_format: { type: "text", mime_type: "application/json", schema: teacherFeedbackSchema },
      }),
    });
    const payload = await response.json().catch(() => null) as GeminiInteraction | null;
    if (!response.ok) {
      const detail = payload?.error?.message ?? "Gemini could not summarize the recording.";
      console.error("Gemini teacher-feedback request failed:", response.status, detail);
      return NextResponse.json({ error: response.status === 429
        ? "Gemini reached a usage or rate limit. Try again later."
        : response.status === 503
          ? "Gemini is temporarily busy. Wait a minute, then try again."
          : "Gemini could not summarize the recording. Check the VS Code terminal for details." }, { status: response.status === 429 || response.status === 503 ? response.status : 502 });
    }
    const output = payload?.output_text ?? payload?.steps
      ?.filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("") ?? "";
    if (!output || (payload?.status && payload.status !== "completed")) {
      console.error("Gemini returned an incomplete teacher summary:", JSON.stringify({ status: payload?.status }));
      return NextResponse.json({ error: "Gemini could not complete the teacher summary. Please try again." }, { status: 502 });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(output); }
    catch { return NextResponse.json({ error: "Gemini returned an unexpected summary format. Please try again." }, { status: 502 }); }
    if (!isTeacherFeedback(parsed)) {
      return NextResponse.json({ error: "Gemini's summary did not match the expected action-item format. Please try again." }, { status: 502 });
    }
    const saved = saveSessionTeacherFeedback({ sessionId, model, feedback: parsed });
    return NextResponse.json(saved);
  } catch (error) {
    console.error("Teacher feedback could not be summarized:", error);
    return NextResponse.json({ error: "The teacher feedback request failed. Check the server terminal and try again." }, { status: 502 });
  }
}
