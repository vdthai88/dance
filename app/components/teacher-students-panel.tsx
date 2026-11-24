"use client";

import { FormEvent, useEffect, useState } from "react";
import { readApiJson } from "../lib/api-response";
import { ConnectionPanel } from "./connection-panel";
import { ProfileSection } from "./profile-section";

type Studio = { id: string; name: string; isDefault?: boolean };
const statusLabels = {
  pending: "Pending", accepted: "Accepted", declined: "Declined", expired: "Expired", delivery_failed: "Email failed",
};
type SentInvite = { id: string; email: string; studioName: string; status: keyof typeof statusLabels };

async function loadSentInvites() {
  const response = await fetch("/api/roster-invites?direction=sent", { cache: "no-store" });
  return await readApiJson(response, "Sent invitations") as SentInvite[];
}

export function TeacherStudentsPanel({ studios }: { studios: Studio[] }) {
  const [email, setEmail] = useState("");
  const [selectedStudio, setSelectedStudio] = useState("");
  const [invites, setInvites] = useState<SentInvite[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const studioId = studios.find(({ id }) => id === selectedStudio)?.id
    ?? studios.find(({ isDefault }) => isDefault)?.id ?? studios[0]?.id ?? "";

  useEffect(() => {
    let active = true;
    void loadSentInvites().then((items) => {
      if (active) setInvites(items);
    }).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : "Could not load sent invitations.");
    });
    return () => { active = false; };
  }, []);

  async function inviteStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/roster-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), studioId }),
      });
      const result = await readApiJson(response, "Student invitation") as { message: string };
      setEmail("");
      setMessage(result.message);
      try { setInvites(await loadSentInvites()); }
      catch { setMessage(`${result.message} Refresh the page to update the list.`); }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send the invitation.");
    } finally { setSaving(false); }
  }

  return <ProfileSection title="Manage your roster" className="teacher-students-panel">
    <form className="inline-form profile-wide" onSubmit={inviteStudent}>
      <label>Student email<input type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="student@example.com" maxLength={254} required /></label>
      <label>Dance studio<select value={studioId} onChange={(event) => setSelectedStudio(event.target.value)} required disabled={!studios.length}>
        {!studios.length && <option value="">No studio available</option>}
        {studios.map((studio) => <option key={studio.id} value={studio.id}>{studio.name}</option>)}
      </select></label>
      <button className="button button-dark" disabled={saving || !email.trim() || !studioId}>{saving ? "Sending..." : "Send invitation"}</button>
    </form>
    {!studios.length && <p className="profile-wide">Create or join a studio before inviting a student.</p>}
    {message && <p className="profile-wide" role="status">{message}</p>}
    {invites.length > 0 && <div className="profile-wide">
      <strong>Sent invitations</strong>
      <ul className="profile-company-list">
        {invites.map((invite) => <li key={invite.id}>{invite.email} at {invite.studioName} <small>{statusLabels[invite.status]}</small></li>)}
      </ul>
    </div>}
    <div className="profile-wide"><ConnectionPanel role="teacher" /></div>
  </ProfileSection>;
}
