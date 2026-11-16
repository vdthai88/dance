"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { authClient } from "../lib/auth-client";

function readableError(error: { message?: string } | null | undefined) {
  return error?.message || "We could not sign you in. Check your details and try again.";
}

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const { error: signInError } = await authClient.signIn.email({ email, password, rememberMe: true });
      if (signInError) {
        setError(readableError(signInError));
        setSubmitting(false);
        return;
      }
      // A full navigation ensures a newly-set session cookie is included in the
      // first protected request, including when the app is opened by LAN IP.
      window.location.assign("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sign-in request could not be completed. Check that the development server is running, then try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="sign-in-title">
        <p className="eyebrow">ONE</p>
        <h1 id="sign-in-title">Welcome back</h1>
        <p className="auth-copy">Sign in to access your dance practice space.</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <form action="/api/local-auth/sign-in" method="post" className="auth-form">
          <label>Email<input name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
        </form>
        <p className="auth-switch">New to One? <Link href="/sign-up">Create an account</Link></p>
      </section>
    </main>
  );
}
