"use client";

import { useEffect, useRef, useState } from "react";
import { readApiJson } from "../lib/api-response";
import { rosterInviteContinuationKey } from "../lib/roster-invite-links";

type Decision = "accepted" | "declined";
type Lookup = { token: string } | { id: string };

async function respond(lookup: Lookup, accept: boolean, automatic: boolean) {
  const response = await fetch("/api/roster-invites/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...lookup, accept, automatic }),
  });
  return await readApiJson(response, "Roster invitation") as { status: Decision };
}

export function RosterInviteActions({ lookup, automaticToken, onResolved }: {
  lookup: Lookup; automaticToken?: string; onResolved?: (status: Decision) => void;
}) {
  const [decision, setDecision] = useState<Decision>();
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const automaticRequest = useRef<Promise<{ status: Decision } | null> | null>(null);

  useEffect(() => {
    if (!automaticToken) return;
    let active = true;
    automaticRequest.current ??= Promise.resolve().then(() => {
      try {
        if (sessionStorage.getItem(rosterInviteContinuationKey) !== automaticToken) return null;
        sessionStorage.removeItem(rosterInviteContinuationKey);
      } catch { return null; }
      setConnecting(true);
      return respond({ token: automaticToken }, true, true);
    });
    void automaticRequest.current.then((result) => {
      if (!result) return;
      const { status } = result;
      if (active) setDecision(status);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Could not accept the invitation.");
    }).finally(() => { if (active) setConnecting(false); });
    return () => { active = false; };
  }, [automaticToken]);

  async function choose(accept: boolean) {
    setWorking(true);
    setError("");
    try {
      const { status } = await respond(lookup, accept, false);
      setDecision(status);
      onResolved?.(status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this invitation.");
    } finally { setWorking(false); }
  }

  if (decision) return <p role="status">{decision === "accepted" ? "Connected. Your teacher can now see you in their studio roster." : "Request declined."}</p>;
  if (connecting) return <p role="status">Connecting you to your teacher...</p>;
  return <div className="profile-actions">
    {error && <p role="alert" className="auth-error">{error}</p>}
    <button className="button button-dark" type="button" disabled={working} onClick={() => void choose(true)}>Accept</button>
    <button className="button button-outline" type="button" disabled={working} onClick={() => void choose(false)}>Decline</button>
  </div>;
}
