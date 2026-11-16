"use client";

import { useState } from "react";
import { authClient } from "../lib/auth-client";
import type { SocialProvider, SocialProviderId } from "../lib/social-auth";

type Props = { providers: SocialProvider[]; mode: "sign-in" | "sign-up" };

function icon(id: SocialProviderId) { return id === "google" ? "G" : id === "apple" ? "●" : "f"; }

export function SocialAuthButtons({ providers, mode }: Props) {
  const [working, setWorking] = useState<SocialProviderId | null>(null);
  const [error, setError] = useState("");
  if (providers.length === 0) return null;

  async function continueWith(provider: SocialProviderId) {
    setWorking(provider);
    setError("");
    const callback = new URL("/auth/complete", window.location.origin);
    if (mode === "sign-up") {
      const selectedRole = document.querySelector<HTMLInputElement>('input[name="role"]:checked')?.value;
      callback.searchParams.set("role", selectedRole === "teacher" ? "teacher" : "student");
    }
    const result = await authClient.signIn.social({ provider, callbackURL: `${callback.pathname}${callback.search}`, requestSignUp: mode === "sign-up" });
    if (result.error) {
      setError(result.error.message || `We could not continue with ${provider}.`);
      setWorking(null);
    }
  }

  return <div className="social-auth" aria-label="Social sign in options">
    <div className="social-divider"><span>or continue with</span></div>
    <div className="social-auth-buttons">{providers.map((provider) => <button key={provider.id} type="button" className="social-auth-button" onClick={() => void continueWith(provider.id)} disabled={working !== null}>
      <span aria-hidden="true" className={`social-icon social-icon-${provider.id}`}>{icon(provider.id)}</span>
      {working === provider.id ? `Connecting to ${provider.label}…` : `Continue with ${provider.label}`}
    </button>)}</div>
    {error && <p className="auth-error" role="alert">{error}</p>}
  </div>;
}
