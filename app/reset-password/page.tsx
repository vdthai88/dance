import type { Metadata } from "next";
import Link from "next/link";
import { NewPasswordFields } from "../components/new-password-fields";
import { passwordEntryMessages } from "../lib/password-policy";

export const metadata: Metadata = { referrer: "same-origin" };

const messages: Record<string, string> = {
  ...passwordEntryMessages,
  "rate-limited": "Too many attempts. Wait a moment and try again.",
  unavailable: "We couldn’t reset your password. Try again in a moment.",
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const validLink = typeof token === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(token) && error !== "INVALID_TOKEN" && error !== "invalid-token";
  const message = error ? messages[error] ?? messages.unavailable : null;
  return <main className="auth-page"><section className="auth-card" aria-labelledby="reset-password-title">
    <h1 id="reset-password-title">Reset your password</h1>
    {validLink ? <>
      {message && <p className="auth-error" role="alert">{message}</p>}
      <form className="auth-form" action="/api/local-auth/reset-password" method="post">
        <input type="hidden" name="token" value={token} />
        <NewPasswordFields label="New password" />
        <button type="submit">Reset password</button>
      </form>
    </> : <p className="auth-error" role="alert">This reset link is invalid, expired, or already used. <Link href="/forgot-password">Request a new link</Link>.</p>}
    <p className="auth-switch"><Link href="/sign-in">Back to sign in</Link></p>
  </section></main>;
}
