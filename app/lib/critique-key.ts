import { createHash } from "node:crypto";

/** A critique belongs to an account, even when other accounts upload identical bytes. */
export function makeCritiqueKey(earlierHash: string, newerHash: string | null, userId: string, subjects?: { earlier?: string | null; newer?: string | null }): string {
  if (!userId) throw new Error("A signed-in account is required for a critique key.");
  return createHash("sha256")
    .update(JSON.stringify(subjects?.earlier || subjects?.newer
      ? ["account-critique-subject-v2", userId, earlierHash, newerHash, subjects.earlier ?? null, subjects.newer ?? null]
      : ["account-critique-v1", userId, earlierHash, newerHash]))
    .digest("hex");
}
