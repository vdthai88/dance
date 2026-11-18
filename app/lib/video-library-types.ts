import type { DanceCritique } from "./gemini-critique";

export type LibraryVideo = {
  id: string;
  filename: string;
  contentType: string | null;
  byteSize: number;
  createdAt: string;
  sessionName: string | null;
  available: boolean;
  canDelete: boolean;
  groupId: string | null;
};
export type VideoGroup = { id: string; name: string; collapsed: boolean };
export type LibraryUploadResult = LibraryVideo & { alreadyExists: boolean; existingGroupName?: string | null };
export type LibraryReview = {
  key: string;
  createdAt: string;
  critique: DanceCritique;
  earlierVideo: LibraryVideo | null;
  newerVideo: LibraryVideo | null;
  comparison: boolean;
  earlierSongStart: number;
  newerSongStart: number;
};
export type LibraryVideoDetails = { video: LibraryVideo; reviews: LibraryReview[] };
