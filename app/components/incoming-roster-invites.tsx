"use client";

import { useEffect, useState } from "react";
import { readApiJson } from "../lib/api-response";
import { RosterInviteActions } from "./roster-invite-actions";
import { ProfileSection } from "./profile-section";

type Invite = { id: string; teacherName: string; studioName: string };

export function IncomingRosterInvites({ separate, onAccepted }: { separate?: boolean; onAccepted: () => void }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/roster-invites", { cache: "no-store" }).then(async (response) => {
      const items = await readApiJson(response, "Teacher invitations") as Invite[];
      if (active) setInvites(items);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Could not load teacher invitations.");
    });
    return () => { active = false; };
  }, []);

  if (error) return <p className="profile-wide" role="alert">{error}</p>;
  if (!invites.length) return null;
  const requests = <div className="profile-wide">
    {!separate && <strong>Teacher invitations</strong>}
    <ul className="profile-company-list">
      {invites.map((invite) => <li key={invite.id}>
        <p>{invite.teacherName} invited you to join their roster at {invite.studioName}.</p>
        <RosterInviteActions lookup={{ id: invite.id }} onResolved={(status) => { if (status === "accepted") onAccepted(); }} />
      </li>)}
    </ul>
  </div>;
  return separate ? <ProfileSection title="Teacher invitations" className="company-form">{requests}</ProfileSection> : requests;
}
