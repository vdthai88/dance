"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
      router.replace("/?page=profile&required=1");
      router.refresh();
    }
    void complete();
    return () => { cancelled = true; };
  }, [role, router]);

  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">ONE</p><h1>Just a moment</h1><p className="auth-copy">{message}</p></section></main>;
}
