export type ProgressStatus = "improved" | "keep_practising" | "new" | "unassessable";

export type CritiqueObservation = {
  timestampSeconds: number | null;
  area: string;
  observation: string;
  suggestedAdjustment: string;
  exercise: string;
  confidence: "high" | "medium" | "low";
  video?: "earlier" | "new" | "both";
  progressStatus?: ProgressStatus;
  progressReason?: string;
  baselineObservationIndex?: number | null;
};

export type DanceCritique = {
  summary: string;
  observations: CritiqueObservation[];
  limitations: string[];
  comparison?: string;
  subject?: { description: string; referenceSeconds: number };
};

export type TeacherFeedback = {
  summary: string;
  actionItems: Array<{
    title: string;
    details: string;
    priority: "high" | "medium" | "low";
  }>;
};

export const TEACHER_FEEDBACK_PROMPT = `You are an assistant helping a dance teacher organize spoken coaching notes. Summarize only what the teacher says about the selected student's dance video. Return a short, faithful summary and clear action items the student can practice. Keep the teacher's meaning and dance terminology. Do not invent technique corrections, add advice the teacher did not give, or infer anything about the video. Remove filler and repetition. If the teacher's meaning is unclear, preserve that uncertainty.`;

export const teacherFeedbackSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "A concise summary of the teacher's spoken feedback." },
    actionItems: {
      type: "array",
      description: "Specific practice actions stated or directly implied by the teacher.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "A short action heading." },
          details: { type: "string", description: "A clear, actionable explanation faithful to what the teacher said." },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["title", "details", "priority"],
      },
    },
  },
  required: ["summary", "actionItems"],
};

export function isTeacherFeedback(value: unknown): value is TeacherFeedback {
  if (!value || typeof value !== "object") return false;
  const feedback = value as Record<string, unknown>;
  return typeof feedback.summary === "string" &&
    Array.isArray(feedback.actionItems) &&
    feedback.actionItems.every((item) => {
      if (!item || typeof item !== "object") return false;
      const action = item as Record<string, unknown>;
      return typeof action.title === "string" && typeof action.details === "string" &&
        ["high", "medium", "low"].includes(String(action.priority));
    });
}

export const DANCE_CRITIQUE_PROMPT = `Act as an experienced dance instructor. Analyze this video and provide a constructive, technically detailed critique. Evaluate posture, balance, body alignment, footwork, arm placement, movement transitions, timing, musicality, control, and expression. Identify specific moments where the technique could improve. For each issue, explain what you observe, what the dancer should be doing instead, and give a practical exercise to correct it. Distinguish clearly between what you can actually observe and what you cannot determine from the video.

Return a concise, supportive critique. Do not assign an overall grade or claim to know the dancer's intent. Only describe details visible or audible in the clip. If a body part is out of frame, obscured, or too brief to assess, say so and lower your confidence. Use timestamps in seconds and include a timestamp only when you can identify the moment. Avoid presenting style-dependent choices as errors when the dance style is unknown.`;

export const danceCritiqueSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "A short encouraging overview of the performance and the main opportunity to improve.",
    },
    observations: {
      type: "array",
      description: "Specific moments the dancer can review. Include strengths as well as actionable improvements.",
      items: {
        type: "object",
        properties: {
          timestampSeconds: { type: ["number", "null"], description: "Time in the video in seconds, or null if no precise moment is identifiable." },
          area: { type: "string", description: "One category such as posture, balance, footwork, timing, or transitions." },
          observation: { type: "string", description: "What is directly visible or audible in the clip." },
          suggestedAdjustment: { type: "string", description: "A constructive adjustment, or explain why no change is clearly warranted." },
          exercise: { type: "string", description: "A practical drill, or an empty string when this is a strength rather than an issue." },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["timestampSeconds", "area", "observation", "suggestedAdjustment", "exercise", "confidence"],
      },
    },
    limitations: {
      type: "array",
      description: "Important things that cannot be determined because of framing, video quality, missing context, or sampling.",
      items: { type: "string" },
    },
  },
  required: ["summary", "observations", "limitations"],
};

export const DANCE_COMPARISON_PROMPT = `Act as an experienced dance instructor comparing two practice videos of the same dancer. The first video is the earlier take; the second video is the newer take. This review belongs to the newer take: assess progress against the earlier take and any supplied baseline critique, then add fresh observations about the newer performance. Explain which previous issues are resolved, still present, changed, or unassessable. Also identify new strengths and useful improvement opportunities when observable. Return at least five distinct, useful notes across posture, balance, alignment, footwork, arm placement, transitions, timing, musicality, control, and expression. Each note must give an observable strength, change, or improvement opportunity and a practical adjustment or exercise. Describe changes only when clearly visible in both videos. Do not infer improvement when the clips show different choreography, camera angles, framing, or conditions. Never invent issues to reach five notes: if an area is unclear, use low confidence, state the limitation, and give a cautious review cue based only on what can be seen. Distinguish clearly between evidence and uncertainty. Do not assign a score or grade. Mark observations as video "new" and use timestamps in the newer video, so each note can be reviewed with that video alone. Use null when no precise moment is identifiable.

Classify every note with progressStatus independently of video: video "new" means the newer clip, NOT a new coaching point. Revisit each supplied baseline note using its baselineObservationIndex. Use "improved" only for observable progress, "keep_practising" when the same focus remains or needs more attention, and "unassessable" when footage, alignment, choreography, or camera differences prevent a reliable judgment. Use "new" only for genuinely additional observations that do not repeat a baseline point; its baselineObservationIndex must be null. Without a supplied baseline, use null for baselineObservationIndex and compare only clearly corresponding movements in both videos. Give a specific progressReason for every classification. Keep the language encouraging without concealing what still needs practice. Never infer progress from timing markers alone or treat an unseen issue as resolved.`;

export const danceComparisonSchema = {
  ...danceCritiqueSchema,
  properties: {
    ...danceCritiqueSchema.properties,
    comparison: { type: "string", description: "A concise comparison of visible changes between the earlier and newer take." },
    observations: {
      ...danceCritiqueSchema.properties.observations,
      minItems: 5,
      items: {
        ...danceCritiqueSchema.properties.observations.items,
        properties: {
          ...danceCritiqueSchema.properties.observations.items.properties,
          video: { type: "string", enum: ["earlier", "new", "both"], description: "Which clip this note refers to; timestamps refer to that clip." },
          progressStatus: { type: "string", enum: ["improved", "keep_practising", "new", "unassessable"], description: "Progress classification, independent of which video contains the timestamp. improved: visible progress on a previous note; keep_practising: a previous focus still needs work, including unchanged or less controlled execution; new: a genuinely additional observation; unassessable: the same movement cannot be compared reliably." },
          progressReason: { type: "string", description: "Explain the classification with concrete earlier-versus-newer evidence, or explain what is new or why comparison is uncertain. Be constructive and do not use worse, regression, or failure as labels." },
          baselineObservationIndex: { type: ["integer", "null"], description: "The supplied baseline note's one-based index for a revisited note. Use null for a new note or a comparison without a supplied baseline note." },
        },
        required: [...danceCritiqueSchema.properties.observations.items.required, "video", "progressStatus", "progressReason", "baselineObservationIndex"],
      },
    },
  },
  required: [...danceCritiqueSchema.required, "comparison"],
};

export function isDanceCritique(value: unknown): value is DanceCritique {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.summary === "string" &&
    (result.comparison === undefined || typeof result.comparison === "string") &&
    Array.isArray(result.observations) &&
    (result.comparison === undefined || result.observations.length >= 5) &&
    result.observations.every((item) => {
      if (!item || typeof item !== "object") return false;
      const observation = item as Record<string, unknown>;
      return (
        (observation.timestampSeconds === null || (typeof observation.timestampSeconds === "number" && Number.isFinite(observation.timestampSeconds) && observation.timestampSeconds >= 0)) &&
        typeof observation.area === "string" &&
        typeof observation.observation === "string" &&
        typeof observation.suggestedAdjustment === "string" &&
        typeof observation.exercise === "string" &&
        (observation.progressStatus === undefined || ["improved", "keep_practising", "new", "unassessable"].includes(String(observation.progressStatus))) &&
        (observation.progressReason === undefined || typeof observation.progressReason === "string") &&
        (observation.baselineObservationIndex === undefined || observation.baselineObservationIndex === null ||
          (typeof observation.baselineObservationIndex === "number" && Number.isInteger(observation.baselineObservationIndex) && observation.baselineObservationIndex > 0)) &&
        (observation.video === undefined || ["earlier", "new", "both"].includes(String(observation.video))) &&
        ["high", "medium", "low"].includes(String(observation.confidence))
      );
    }) &&
    Array.isArray(result.limitations) &&
    result.limitations.every((item) => typeof item === "string")
  );
}

/** New comparison responses require explicit progress; legacy saved critiques remain readable. */
export function hasComparisonProgress(value: unknown, baselineCount?: number): value is DanceCritique {
  return isDanceCritique(value) && typeof value.comparison === "string" && value.observations.every((note) =>
    note.progressStatus !== undefined && typeof note.progressReason === "string" && note.progressReason.trim().length > 0 &&
    note.baselineObservationIndex !== undefined &&
    (note.baselineObservationIndex === null || baselineCount === undefined || note.baselineObservationIndex <= baselineCount) &&
    (note.progressStatus !== "new" || note.baselineObservationIndex === null));
}
