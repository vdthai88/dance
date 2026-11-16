"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : (parts[0]?.slice(0, 2).toUpperCase() || "U");
}

export function AccountMenu() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [profileAvatar, setProfileAvatar] = useState({ userId: "", initials: "" });

  useEffect(() => {
    if (!session) return;
    const userId = session.user.id;
    void fetch("/api/profile", { cache: "no-store" }).then(async (response) => {
      const profile = await response.json() as { firstName?: string; lastName?: string };
      const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
      if (fullName) setProfileAvatar({ userId, initials: initialsFor(fullName) });
    }).catch(() => { /* Keep the account-name fallback. */ });
  }, [session]);

  if (isPending) return <span className="account-status">Checking account…</span>;

  if (!session) {
    return <Link className="account-link" href="/sign-in">Sign in</Link>;
  }

  const initials = profileAvatar.userId === session.user.id ? profileAvatar.initials : initialsFor(session.user.name || session.user.email);

  return (
    <div className="account-menu">
      <span className="account-avatar" title={session.user.email} aria-label={`Signed in as ${session.user.name}`}>{initials}</span>
      <button
        className="account-link"
        type="button"
        onClick={async () => {
          await authClient.signOut();
          router.push("/sign-in");
          router.refresh();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
