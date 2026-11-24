import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SocialAuthButtons } from "../components/social-auth-buttons";
import { NewPasswordFields } from "../components/new-password-fields";
import { passwordEntryMessages } from "../lib/password-policy";
import { enabledSocialProviders } from "../lib/social-auth";
import { stagingAccessEnabled, stagingAccessMessage } from "../lib/staging-access";
import { usesPostgres } from "../lib/database-driver";
import { findRosterInvite } from "../lib/postgres-roster-invite-store";
import { rosterInvitePath } from "../lib/roster-invite-links";

export const metadata: Metadata = { referrer: "same-origin" };

const messages: Record<string, string> = {
  ...passwordEntryMessages,
  "staging-access": stagingAccessMessage,
  "account-not-created": "We could not create that account. It may already use this email address.",
  "invalid-request": "Enter a valid email address and a password with at least 8 characters.",
  "rate-limited": "Too many attempts. Please wait a moment and try again.",
  "verification-delivery": "We could not send a verification email. Try creating your account again in a few minutes. If you already registered, sign in to request a new link.",
};

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string; invite?: string }> }) {
  const params = await searchParams;
  const providers = enabledSocialProviders();
  const invitePath = rosterInvitePath(params.invite);
  const invitation = invitePath && usesPostgres() ? await findRosterInvite(params.invite!) : null;
  if (params.invite && (!invitation || invitation.status !== "pending" || invitation.recipientId)) {
    redirect(invitePath ?? "/sign-up");
  }
  const signIn = invitePath ? `/sign-in?${new URLSearchParams({ next: invitePath })}` : "/sign-in";
  const error = params.error ? messages[params.error] || "We could not create your account. Please try again." : "";
  return <main className="auth-page"><section className="auth-card" aria-labelledby="sign-up-title">
    <p className="eyebrow">ONE</p><h1 id="sign-up-title">Create your account</h1>
    <p className="auth-copy">{invitation
      ? `By joining with this email, you agree to connect with ${invitation.teacherName} at ${invitation.studioName}.`
      : "Start keeping your practice sessions and feedback in one place."}</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {stagingAccessEnabled() && !error && <p className="auth-copy">{stagingAccessMessage}</p>}
    <form action="/api/local-auth/sign-up" method="post" className="auth-form">
      {invitation && <input type="hidden" name="rosterInvite" value={params.invite} />}
      <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} defaultValue={invitation?.email} readOnly={Boolean(invitation)} required /></label>
      <NewPasswordFields />
      {!invitation && <fieldset className="role-picker"><legend>I am joining as a</legend><label><input type="radio" name="role" value="student" defaultChecked /> Student</label><label><input type="radio" name="role" value="teacher" /> Teacher</label></fieldset>}
      <button type="submit">Create account</button>
    </form>
    <SocialAuthButtons providers={providers} mode="sign-up" inviteNext={invitePath} />
    <p className="auth-switch">Already have an account? <Link href={signIn}>Sign in</Link></p>
  </section></main>;
}
