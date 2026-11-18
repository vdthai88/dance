export type SongAlignment = { earlierSongStart: number; newerSongStart: number; source: "auto" | "manual" };

export function parseSongAlignment(earlier: unknown, newer: unknown, source: unknown): SongAlignment | null {
  if (source !== "auto" && source !== "manual") return null;
  if (typeof earlier !== "string" || !earlier.trim() || typeof newer !== "string" || !newer.trim()) return null;
  const earlierSongStart = Number(earlier);
  const newerSongStart = Number(newer);
  if (!Number.isFinite(earlierSongStart) || earlierSongStart < 0 || !Number.isFinite(newerSongStart) || newerSongStart < 0) return null;
  return { earlierSongStart, newerSongStart, source };
}

export function sameSongAlignment(cached: { earlierSongStart?: number; newerSongStart?: number }, alignment: SongAlignment) {
  return cached.earlierSongStart === alignment.earlierSongStart && cached.newerSongStart === alignment.newerSongStart;
}
