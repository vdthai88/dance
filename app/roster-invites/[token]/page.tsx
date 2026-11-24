import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { RosterInviteActions } from "../../components/roster-invite-actions";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { findRosterInvite } from "../../lib/postgres-roster-invite-store";
import { rosterInvitePath } from "../../lib/roster-invite-links";

export const metadata: Metadata = { referrer: "same-origin", robots: { index: false, follow: false } };

export default async function RosterInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const path = rosterInvitePath(token);
  const invitation = path && usesPostgres() ? await findRosterInvite(token) : null;
  const user = invitation ? await getAuthenticatedUser({ headers: await headers() }) : null;
  const matches = user && user.email.toLowerCase() === invitation?.email && (!invitation.recipientId || invitation.recipientId === user.id);
  const signIn = `/sign-in?${new URLSearchParams({ next: path ?? "/" })}`;

  return <main className="auth-page"><section className="auth-card">
    <h1>Connect with your dance teacher</h1>
    {invitation ? <>
      <p className="auth-copy"><strong>{invitation.teacherName}</strong> invited you to connect at <strong>{invitation.studioName}</strong>.</p>
      {matches && user.emailVerified ? (invitation.status === "accepted"
        ? <p role="status">You are connected.</p>
        : <RosterInviteActions lookup={{ token }} automaticToken={invitation.recipientId ? undefined : token} />)
        : <>
          <p className="auth-copy">{user && matches ? "Verify your email to continue." : "Sign in using the email address that received the invitation."}</p>
          {!invitation.recipientId && invitation.status === "pending" && <p className="auth-copy">Signing in through this invitation with your verified email connects you to the teacher and studio.</p>}
          <p className="auth-switch"><Link href={signIn}>Sign in</Link>
            {invitation.status === "pending" && !invitation.recipientId && <> or <Link href={`/sign-up?invite=${token}`}>create a student account and connect</Link></>}
          </p>
        </>}
    </> : <p role="alert">This invitation has expired or is no longer available.</p>}
    <p className="auth-switch"><Link href="/?page=profile">Go to The One Dance</Link></p>
  </section></main>;
}
