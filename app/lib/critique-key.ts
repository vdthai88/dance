import { createHash } from "node:crypto";

/** A critique belongs to an account, even when other accounts upload identical bytes. */
export function makeCritiqueKey(earlierHash: string, newerHash: string | null, userId: string): string {
  if (!userId) throw new Error("A signed-in account is required for a critique key.");
  return createHash("sha256")
    .update(JSON.stringify(["account-critique-v1", userId, earlierHash, newerHash]))
    .digest("hex");
}
