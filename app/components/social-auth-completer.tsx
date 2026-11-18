"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readApiJson } from "../lib/api-response";

export function SocialAuthCompleter({ role }: { role: "student" | "teacher" | null }) {
  const router = useRouter();
  const [message, setMessage] = useState("Completing your sign-in…");

  useEffect(() => {
    let cancelled = false;
    async function complete() {
      const endpoint = role ? "/api/account/role" : "/api/account/role/default";
      const response = await fetch(endpoint, role ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) } : { method: "POST" });
      if (!response.ok) {
        if (!cancelled) setMessage("Your account was created, but we could not save its role. Please sign in again.");
        return;
      }
      const landingResponse = await fetch("/api/account/landing", { cache: "no-store" });
      const landing = await readApiJson(landingResponse, "Account setup") as { destination?: string };
      if (cancelled) return;
      if (!landing.destination || !["/?page=profile&required=1", "/?page=replai", "/?page=coaching"].includes(landing.destination)) throw new Error("Could not determine your account's starting page. Please sign in again.");
      router.replace(landing.destination);
      router.refresh();
    }
    void complete().catch((error: unknown) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not complete sign-in. Please try again."); });
    return () => { cancelled = true; };
  }, [role, router]);

  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">ONE</p><h1>Just a moment</h1><p className="auth-copy">{message}</p></section></main>;
}
