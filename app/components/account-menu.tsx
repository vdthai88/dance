"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "../lib/auth-client";

export function AccountMenu() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <span className="account-status">Checking account…</span>;

  if (!session) {
    return <Link className="account-link" href="/sign-in">Sign in</Link>;
  }

  return (
    <div className="account-menu">
      <span className="account-name" title={session.user.email}>{session.user.name}</span>
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
