import { getAuthenticatedUser } from "../../../lib/auth-session";
import { usesPostgres } from "../../../lib/database-driver";
import { decideRosterInvite } from "../../../lib/postgres-roster-invite-store";
import { isRosterInviteToken } from "../../../lib/roster-invite-links";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "Sign in using the invited email." }, { status: 401 });
  if (!usesPostgres()) return Response.json({ error: "Invitations are unavailable." }, { status: 503 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 415 });
  const body = await request.json().catch(() => null) as { token?: unknown; id?: unknown; accept?: unknown; automatic?: unknown } | null;
  const token = body?.token;
  const id = body?.id;
  const accept = body?.accept;
  const automatic = body?.automatic === true;
  const lookup = isRosterInviteToken(token) ? { token } : typeof id === "string" && /^[\da-f-]{36}$/i.test(id) ? { id } : null;
  if (!lookup || typeof accept !== "boolean" || (automatic && (!accept || !("token" in lookup)))) {
    return Response.json({ error: "This invitation is invalid." }, { status: 400 });
  }
  try {
    const result = await decideRosterInvite(user.id, lookup, accept, automatic);
    if (result === "accepted" || result === "declined") return Response.json({ status: result });
    const message = result === "verification-required" ? "Verify your email before accepting this invitation."
      : result === "email-mismatch" ? "Sign in using the email address that received the invitation."
        : result === "consent-required" ? "Review and accept this request to connect."
          : "This invitation has expired or is no longer available.";
    return Response.json({ error: message }, { status: result === "unavailable" ? 409 : 403 });
  } catch (error) {
    console.error("Could not respond to roster invitation:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Could not update this invitation. Try again." }, { status: 500 });
  }
}
