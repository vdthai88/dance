import Link from "next/link";
import { SocialAuthButtons } from "../components/social-auth-buttons";
import { enabledSocialProviders } from "../lib/social-auth";

const messages: Record<string, string> = {
  "account-not-created": "We could not create that account. It may already use this email address.",
  "invalid-request": "Enter a valid email address and a password with at least 8 characters.",
  "rate-limited": "Too many attempts. Please wait a moment and try again.",
};

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const providers = enabledSocialProviders();
  const error = params.error ? messages[params.error] || "We could not create your account. Please try again." : "";
  return <main className="auth-page"><section className="auth-card" aria-labelledby="sign-up-title">
    <p className="eyebrow">ONE</p><h1 id="sign-up-title">Create your account</h1><p className="auth-copy">Start keeping your practice sessions and feedback in one place.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <form action="/api/local-auth/sign-up" method="post" className="auth-form">
      <label>Email<input name="email" type="email" autoComplete="email" maxLength={320} required /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
      <fieldset className="role-picker"><legend>I am joining as a</legend><label><input type="radio" name="role" value="student" defaultChecked /> Student</label><label><input type="radio" name="role" value="teacher" /> Teacher</label></fieldset>
      <button type="submit">Create account</button>
    </form>
    <SocialAuthButtons providers={providers} mode="sign-up" />
    <p className="auth-switch">Already have an account? <Link href="/sign-in">Sign in</Link></p>
  </section></main>;
}
