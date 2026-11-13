"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../lib/auth-client";

function readableError(error: { message?: string } | null | undefined) {
  return error?.message || "We could not create your account. Try a different email address.";
}

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"student" | "teacher">("student");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    setSubmitting(true);
    setError("");
    const accountName = email.trim().split("@")[0] || "One member";
    const { error: signUpError } = await authClient.signUp.email({ name: accountName, email, password });
    if (signUpError) {
      setError(readableError(signUpError));
      setSubmitting(false);
      return;
    }
    const roleResponse = await fetch("/api/account/role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const roleResult = await roleResponse.json().catch(() => null) as { error?: string } | null;
    if (!roleResponse.ok) {
      setError(roleResult?.error || "Your account was created, but we could not save your role. Please sign in and try again.");
      setSubmitting(false);
      return;
    }
    router.replace("/?page=profile&required=1");
    router.refresh();
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="sign-up-title">
        <p className="eyebrow">ONE</p>
        <h1 id="sign-up-title">Create your account</h1>
        <p className="auth-copy">Start keeping your practice sessions and feedback in one place.</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <form onSubmit={submit} className="auth-form">
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <fieldset className="role-picker"><legend>I am joining as a</legend><label><input type="radio" name="role" value="student" checked={role === "student"} onChange={() => setRole("student")} /> Student</label><label><input type="radio" name="role" value="teacher" checked={role === "teacher"} onChange={() => setRole("teacher")} /> Teacher</label></fieldset>
          <button type="submit" disabled={submitting}>{submitting ? "Creating account…" : "Create account"}</button>
        </form>
        <p className="auth-switch">Already have an account? <Link href="/sign-in">Sign in</Link></p>
      </section>
    </main>
  );
}
