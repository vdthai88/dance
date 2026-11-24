import { getAuthenticatedUser } from "../../lib/auth-session";
import { emailVerificationEnabled, sendRosterInviteEmail } from "../../lib/auth-email";
import { usesPostgres } from "../../lib/database-driver";
import { isValidEmailAddress } from "../../lib/email-auth-request";
import { createRosterInvite, failRosterInviteDelivery, listReceivedRosterInvites, listSentRosterInvites } from "../../lib/postgres-roster-invite-store";
import { rosterInvitePath } from "../../lib/roster-invite-links";
import { stagingEmailAllowed } from "../../lib/staging-access";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "Sign in to view your invitations." }, { status: 401 });
  if (!usesPostgres()) return Response.json([]);
  try {
    const sent = new URL(request.url).searchParams.get("direction") === "sent";
    const invites = sent ? await listSentRosterInvites(user.id) : await listReceivedRosterInvites(user);
    return Response.json(invites, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not read roster invitations:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Could not load roster invitations." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user?.emailVerified) return Response.json({ error: "Sign in with a verified email before inviting a student." }, { status: 403 });
  if (!usesPostgres() || !emailVerificationEnabled) {
    return Response.json({ error: "Invitation email is unavailable in this environment." }, { status: 503 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 415 });
  const body = await request.json().catch(() => null) as { email?: unknown; studioId?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const studioId = typeof body?.studioId === "string" ? body.studioId : "";
  if (!isValidEmailAddress(email) || !studioId || studioId.length > 128 || email === user.email.toLowerCase()) {
    return Response.json({ error: "Enter a student's email address and choose a dance studio." }, { status: 400 });
  }
  if (!stagingEmailAllowed(email)) {
    return Response.json({ error: "This email must be approved for staging before you can invite it." }, { status: 403 });
  }

  try {
    const invite = await createRosterInvite(user.id, studioId, email);
    if (invite.status === "forbidden") return Response.json({ error: "Choose a studio where you can invite students." }, { status: 403 });
    if (invite.status === "rate-limited") return Response.json({ error: "The hourly invitation limit has been reached. Try again later." }, { status: 429 });
    if (invite.status === "created") {
      const url = new URL(rosterInvitePath(invite.token)!, process.env.BETTER_AUTH_URL || "http://localhost:3000");
      try {
        await sendRosterInviteEmail(email, url.href, invite.teacherName, invite.studioName);
      } catch (error) {
        await failRosterInviteDelivery(invite.id);
        console.error("Roster invitation email failed:", error instanceof Error ? error.message : "Unknown delivery error");
        return Response.json({ error: "The invitation email could not be sent. Try again." }, { status: 502 });
      }
    }
    return Response.json({ message: "Invitation submitted. Check its status under Sent invitations." });
  } catch (error) {
    console.error("Could not send roster invitation:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "Could not send the invitation. Try again." }, { status: 500 });
  }
}
