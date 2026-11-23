"use client";

import { FormEvent, useEffect, useState } from "react";
import { ConnectionPanel } from "./connection-panel";
import { ProfileSection } from "./profile-section";

type Organization = { id: string; name: string; type: "studio" | "private_company" | "other" };

export function TeacherStudentsPanel() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch("/api/teacher-organization", { cache: "no-store" }).then(async (response) => {
      const data = await response.json() as { organization?: Organization | null; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load the company.");
      setOrganization(data.organization ?? null);
      setOrganizationId(data.organization?.id ?? "");
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load the company."));
  }, []);

  async function addStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = studentName.trim();
    if (!name) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, organizationId: organizationId || null }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not add the student.");
      setStudentName("");
      setMessage("Student added. They will appear in Coaching when you return there.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not add the student."); }
    finally { setSaving(false); }
  }

  return <ProfileSection title="Manage your roster" className="teacher-students-panel">
    <div className="profile-wide"><p>Add a student directly, or accept requests from students who want to connect with you.</p></div>
    <form className="inline-form profile-wide" onSubmit={addStudent}>
      <label>New student<input value={studentName} onChange={(event) => setStudentName(event.target.value)} placeholder="Student name" maxLength={100} required/></label>
      <label>Company (optional)<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}><option value="">No company</option>{organization && <option value={organization.id}>{organization.name}</option>}</select></label>
      <button className="button button-dark" disabled={saving || !studentName.trim()}>{saving ? "Adding..." : "Add student"}</button>
    </form>
    {message && <p className="profile-wide" role="status">{message}</p>}
    <div className="profile-wide"><ConnectionPanel role="teacher" /></div>
  </ProfileSection>;
}
