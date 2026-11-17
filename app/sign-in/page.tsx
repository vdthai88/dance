import Link from "next/link";
import { SocialAuthButtons } from "../components/social-auth-buttons";
import { PasswordField } from "../components/password-field";
import { enabledSocialProviders } from "../lib/social-auth";

const messages: Record<string, string> = {
  "invalid-credentials": "We could not sign you in with that email and password.",
  "invalid-request": "Enter a valid email address and password.",
  "rate-limited": "Too many attempts. Please wait a moment and try again.",
};

function safeNext(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const params = await searchParams;
  const providers = enabledSocialProviders();
  const error = params.error ? messages[params.error] || "We could not sign you in. Please try again." : "";
  return <main className="auth-page"><section className="auth-card" aria-labelledby="sign-in-title">
    <p className="eyebrow">ONE</p><h1 id="sign-in-title">Welcome back</h1><p className="auth-copy">Sign in to access your dance practice space.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <form action="/api/local-auth/sign-in" method="post" className="auth-form">
      <input type="hidden" name="next" value={safeNext(params.next)} />
      <label>Email<input name="email" type="email" autoComplete="email" maxLength={320} required /></label>
      <PasswordField />
      <button type="submit">Sign in</button>
    </form>
    <SocialAuthButtons providers={providers} mode="sign-in" />
    <p className="auth-switch">New to One? <Link href="/sign-up">Create an account</Link></p>
  </section></main>;
}
