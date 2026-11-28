export const MAX_VIDEO_MB = 600;
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1_000_000;
export const LEGACY_CRITIQUE_BYTES = 250 * 1024 * 1024;
export const LEGACY_VIDEO_MB = 250;
export const VIDEO_PART_BYTES = 16 * 1024 * 1024;

export function videoMimeType(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "mov") return "video/quicktime";
  if (extension === "webm") return "video/webm";
  return "video/mp4";
}
