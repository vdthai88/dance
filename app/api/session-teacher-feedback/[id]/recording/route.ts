import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../../lib/auth-session";
import { usesPostgres } from "../../../../lib/database-driver";
import { isTeacherFeedback, teacherFeedbackSchema } from "../../../../lib/gemini-critique";
import { findPgSessionTeacherFeedback, pgCanAccessSession, updatePgSessionTeacherFeedback } from "../../../../lib/postgres-session-store";
import { canAccessSession, findSessionTeacherFeedback, updateSessionTeacherFeedback } from "../../../../lib/session-store";

export const runtime = "nodejs";
export const maxDuration = 120;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const AUDIO_MIME_TYPES = new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg", "audio/aac", "audio/m4a"]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File) || !audio.size) return NextResponse.json({ error: "Record an instruction before updating this note." }, { status: 400 });
  const mimeType = audio.type.split(";")[0].toLowerCase();
  if (!AUDIO_MIME_TYPES.has(mimeType) || audio.size > 14 * 1024 * 1024) return NextResponse.json({ error: "Use a short recording from Chrome or Edge to update this note." }, { status: 400 });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI feedback has not been configured for this environment." }, { status: 503 });
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to update feedback." }, { status: 401 });
  const existing = usesPostgres() ? await findPgSessionTeacherFeedback(id) : findSessionTeacherFeedback(id);
  if (!existing) return NextResponse.json({ error: "Feedback note not found." }, { status: 404 });
  const hasAccess = usesPostgres() ? await pgCanAccessSession(user.id, existing.sessionId, true) : canAccessSession(user.id, existing.sessionId, true);
  if (!hasAccess) return NextResponse.json({ error: "You do not have permission to update this feedback." }, { status: 403 });
  try {
    const response = await fetch(`${GEMINI_BASE}/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
        input: [
          { type: "text", text: `You are updating an existing dance coaching note. Current note JSON: ${JSON.stringify(existing.feedback)}. Listen to the teacher's instruction. The teacher may ask you to add additional notes, revise specific parts, or replace the whole note. Return the complete updated coaching note as JSON matching the supplied schema. Keep useful existing content unless the teacher clearly asks to replace or remove it.` },
          { type: "audio", data: Buffer.from(await audio.arrayBuffer()).toString("base64"), mime_type: mimeType },
        ],
        response_format: { type: "text", mime_type: "application/json", schema: teacherFeedbackSchema },
      }),
    });
    const payload = await response.json().catch(() => null) as { status?: string; output_text?: string; steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } } | null;
    const output = payload?.output_text ?? payload?.steps?.filter((step) => step.type === "model_output").flatMap((step) => step.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "";
    if (!response.ok || !output || (payload?.status && payload.status !== "completed")) return NextResponse.json({ error: "AI could not update this coaching note. Please try again." }, { status: response.status === 429 || response.status === 503 ? response.status : 502 });
    const updated: unknown = JSON.parse(output);
    if (!isTeacherFeedback(updated)) return NextResponse.json({ error: "AI returned an invalid updated note. Try recording again." }, { status: 502 });
    return NextResponse.json(usesPostgres() ? await updatePgSessionTeacherFeedback(id, updated) : updateSessionTeacherFeedback(id, updated));
  } catch (error) {
    console.error("Could not update teacher feedback from recording:", error);
    return NextResponse.json({ error: "The coaching note could not be updated. Check the server terminal and try again." }, { status: 502 });
  }
}
