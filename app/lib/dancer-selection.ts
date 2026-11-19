export type DancerTarget = { description: string; referenceSeconds: number };
export type DancerDetection = {
  status: "single" | "multiple" | "uncertain";
  confidence: "high" | "medium" | "low";
  referenceSeconds: number;
  candidates: Array<{ description: string }>;
  explanation: string;
};
export type DancerChoiceRequest = { take: "earlier" | "newer"; detection: DancerDetection };

export const DANCER_DETECTION_PROMPT = `Inspect this dance video across its beginning, middle and end. Identify the real people who could be the target of dance feedback. Count each person once; mirror reflections, screens, posters and background audience members are not additional dancers. Include an instructor or demonstrator moving beside another dancer as a possible target; never assume which person the uploader wants reviewed. If two or more plausible targets appear at any point, return multiple. Return single only when exactly one clear target is visible throughout the relevant performance with high confidence. For empty, obscured, crowded or unclear footage, return uncertain. Choose a reference timestamp where the candidates are visible and describe each using clothing and position at that timestamp. Do not infer identities, ages, gender, ethnicity or other sensitive traits. Do not critique technique yet.`;
export const dancerDetectionSchema = {
  type: "object", properties: {
    status: { type: "string", enum: ["single", "multiple", "uncertain"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    referenceSeconds: { type: "number" },
    candidates: { type: "array", maxItems: 8, items: { type: "object", properties: { description: { type: "string" } }, required: ["description"] } },
    explanation: { type: "string" },
  }, required: ["status", "confidence", "referenceSeconds", "candidates", "explanation"],
};
export function isDancerTarget(value: unknown): value is DancerTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as DancerTarget;
  return typeof target.description === "string" && target.description.trim().length > 0 && target.description.length <= 800 &&
    typeof target.referenceSeconds === "number" && Number.isFinite(target.referenceSeconds) && target.referenceSeconds >= 0 && target.referenceSeconds <= 10800;
}
export function isDancerDetection(value: unknown): value is DancerDetection {
  if (!value || typeof value !== "object") return false;
  const detection = value as DancerDetection;
  return ["single", "multiple", "uncertain"].includes(detection.status) && ["high", "medium", "low"].includes(detection.confidence) &&
    typeof detection.explanation === "string" && Array.isArray(detection.candidates) && detection.candidates.length <= 8 &&
    detection.candidates.every((candidate) => isDancerTarget({ description: candidate?.description, referenceSeconds: detection.referenceSeconds })) &&
    isDancerTarget({ description: "reference", referenceSeconds: detection.referenceSeconds });
}
export function automaticDancer(detection: DancerDetection): DancerTarget | null {
  return detection.status === "single" && detection.confidence === "high" && detection.candidates.length === 1
    ? { description: detection.candidates[0].description, referenceSeconds: detection.referenceSeconds } : null;
}
