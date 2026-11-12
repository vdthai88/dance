"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../../lib/auth-client";

export default function InvitationPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  async function accept() {
    setWorking(true); setMessage("");
    const response = await fetch("/api/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: params.token }) });
    const result = await response.json() as { role?: string; error?: string };
    if (!response.ok) { setMessage(result.error || "Could not accept this invitation."); setWorking(false); return; }
    setMessage(`Invitation accepted. You are now connected as a ${result.role}.`);
    setTimeout(() => router.replace("/"), 900);
  }
  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">ONE INVITATION</p><h1>Join your dance team</h1><p className="auth-copy">Accept this invitation using the email address it was sent to.</p>{message && <p className="auth-success">{message}</p>}{isPending ? <p>Checking your account…</p> : session ? <button className="invite-accept" onClick={accept} disabled={working}>{working ? "Accepting…" : "Accept invitation"}</button> : <p className="auth-switch"><Link href={`/sign-in?next=/invitations/${params.token}`}>Sign in</Link> or <Link href="/sign-up">create an account</Link>, then open this invitation link again.</p>}</section></main>;
}
