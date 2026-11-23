export type DancerTarget = { description: string; referenceSeconds: number };
export type DancerBoundingBox = { x: number; y: number; width: number; height: number };
export type DancerDetection = {
  status: "single" | "multiple" | "uncertain";
  confidence: "high" | "medium" | "low";
  visiblePersonCount?: number;
  referenceSeconds: number;
  candidates: Array<{ description: string; box?: DancerBoundingBox }>;
  explanation: string;
};
export type DancerChoiceRequest = { take: "earlier" | "newer"; detection: DancerDetection };

export const DANCER_DETECTION_PROMPT = `Inspect this dance video across its beginning, middle and end. Count every distinct real person visible on the performance area, and return visiblePersonCount. Exclude only clear mirror reflections, images on screens/posters, and people who are unmistakably audience or static background figures; include an instructor, demonstrator, or another person moving with the dancer. Never assume which person the uploader wants reviewed. If two or more plausible dancers or moving people appear at any point, status must be multiple and every plausible dancer must be listed as a candidate. Return single only when exactly one real person is visible throughout the relevant performance with high confidence and visiblePersonCount is 1. For empty, obscured, crowded or unclear footage, return uncertain. Choose a reference timestamp where the candidates are visible. Describe each candidate using clothing and position at that timestamp and, when visible, return a normalized bounding box around the person's full visible body at that exact timestamp. Box coordinates must be between 0 and 1, measured from the top-left of the video: x, y, width, height. Do not infer identities, ages, gender, ethnicity or other sensitive traits. Do not critique technique yet.`;
export const dancerDetectionSchema = {
  type: "object", properties: {
    status: { type: "string", enum: ["single", "multiple", "uncertain"] }, visiblePersonCount: { type: "integer", minimum: 0, maximum: 20 },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    referenceSeconds: { type: "number" },
    candidates: { type: "array", maxItems: 8, items: { type: "object", properties: { description: { type: "string" }, box: { type: "object", properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 }, width: { type: "number", minimum: 0, maximum: 1 }, height: { type: "number", minimum: 0, maximum: 1 } }, required: ["x", "y", "width", "height"] } }, required: ["description"] } },
    explanation: { type: "string" },
  }, required: ["status", "confidence", "visiblePersonCount", "referenceSeconds", "candidates", "explanation"],
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
    (detection.visiblePersonCount === undefined || (Number.isInteger(detection.visiblePersonCount) && detection.visiblePersonCount >= 0 && detection.visiblePersonCount <= 20)) &&
    typeof detection.explanation === "string" && Array.isArray(detection.candidates) && detection.candidates.length <= 8 &&
    detection.candidates.every((candidate) => isDancerTarget({ description: candidate?.description, referenceSeconds: detection.referenceSeconds }) && (!candidate.box || (typeof candidate.box.x === "number" && typeof candidate.box.y === "number" && typeof candidate.box.width === "number" && typeof candidate.box.height === "number" && candidate.box.x >= 0 && candidate.box.y >= 0 && candidate.box.width > 0 && candidate.box.height > 0 && candidate.box.x + candidate.box.width <= 1.001 && candidate.box.y + candidate.box.height <= 1.001))) &&
    isDancerTarget({ description: "reference", referenceSeconds: detection.referenceSeconds });
}
export function needsDancerConfirmation(savedTarget: DancerTarget | null, chooseAgain: boolean): boolean {
  return chooseAgain || !savedTarget;
}
