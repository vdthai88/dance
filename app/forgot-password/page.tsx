import Link from "next/link";

const messages: Record<string, string> = {
  "invalid-email": "Enter a valid email address.",
  "rate-limited": "Too many attempts. Wait a moment and try again.",
  unavailable: "Password reset is temporarily unavailable. Please try again later.",
};

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;
  const message = error ? messages[error] ?? messages.unavailable : null;
  return <main className="auth-page"><section className="auth-card" aria-labelledby="forgot-password-title">
    <h1 id="forgot-password-title">Forgot your password?</h1>
    {sent === "1" ? <p className="auth-copy" role="status">If this email has a password account, check your inbox for a reset link. If you normally sign in with Google, use Continue with Google.</p> : <>
      <p className="auth-copy">Enter the email address you use to sign in.</p>
      {message && <p className="auth-error" role="alert">{message}</p>}
      <form className="auth-form" action="/api/local-auth/forgot-password" method="post">
        <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        <button type="submit">Send reset link</button>
      </form>
    </>}
    <p className="auth-switch"><Link href="/sign-in">Back to sign in</Link></p>
  </section></main>;
}
