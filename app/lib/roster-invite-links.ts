export function isRosterInviteToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function rosterInvitePath(token: unknown): string | undefined {
  return isRosterInviteToken(token) ? `/roster-invites/${token}` : undefined;
}

export function rosterInviteTokenFromPath(path: unknown): string | undefined {
  if (typeof path !== "string" || !path.startsWith("/roster-invites/")) return;
  const token = path.slice("/roster-invites/".length);
  return isRosterInviteToken(token) ? token : undefined;
}
export const rosterInviteContinuationKey = "roster-invite-sign-in";
