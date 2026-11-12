"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { DanceCritique, TeacherFeedback } from "../lib/gemini-critique";
import { ConnectionPanel } from "./connection-panel";

type Role = "student" | "teacher";
type Student = { id: string; name: string; organizationId: string | null; organizationName: string | null; createdAt: string };
type CompanyType = "studio" | "private_company" | "other";
type TeacherOrganization = { id: string; name: string; type: CompanyType };
type CompanyMember = { userId: string; name: string; email: string | null; role: "owner" | "admin" | "teacher" | "staff"; joinedAt: string };
export type PracticeSession = {
  id: string;
  studentId: string;
  studentName: string;
  sessionDate: string;
  location: string;
  createdAt: string;
};
type SessionSnapshot = {
  session: PracticeSession;
  videos: Array<{ hash: string; filename: string; createdAt: string }>;
  teacherFeedback: Array<{ id: string; model: string; feedback: TeacherFeedback; createdAt: string }>;
  aiCritiques: Array<{ key: string; model: string; critique: DanceCritique; createdAt: string }>;
};

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function SessionPanel({ role, videoFile, onSessionChange }: {
  role: Role;
  videoFile: File | null;
  onSessionChange: (session: PracticeSession | null) => void;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [newStudentName, setNewStudentName] = useState("");
  const [newStudentOrganizationId, setNewStudentOrganizationId] = useState("");
  const [teacherOrganization, setTeacherOrganization] = useState<TeacherOrganization | null>(null);
  const [isCompanyOwner, setIsCompanyOwner] = useState(false);
  const [companyMembers, setCompanyMembers] = useState<CompanyMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"teacher" | "student">("teacher");
  const [inviteStudentId, setInviteStudentId] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState<CompanyType>("studio");
  const [sessionDate, setSessionDate] = useState(today);
  const [location, setLocation] = useState("");
  const [isCreatingStudent, setIsCreatingStudent] = useState(false);
  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [isSavingOwnerStatus, setIsSavingOwnerStatus] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isAttachingVideo, setIsAttachingVideo] = useState(false);
  const [error, setError] = useState("");
  const selectedStudent = students.find((student) => student.id === selectedStudentId);

  useEffect(() => {
    let active = true;
    void fetch("/api/teacher-organization")
      .then(async (response) => {
        const result = await response.json() as { organization?: TeacherOrganization | null; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load the teacher company.");
        if (active && result.organization) {
          setTeacherOrganization(result.organization);
          setCompanyName(result.organization.name);
          setCompanyType(result.organization.type);
          setNewStudentOrganizationId(result.organization.id);
        }
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load the teacher company."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!teacherOrganization || !isCompanyOwner) {
      return;
    }
    let active = true;
    void fetch("/api/company-members")
      .then(async (response) => {
        const result = await response.json() as CompanyMember[] | { error?: string };
        if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not load company members.");
        if (active) setCompanyMembers(result as CompanyMember[]);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load company members."); });
    return () => { active = false; };
  }, [teacherOrganization, isCompanyOwner]);

  useEffect(() => {
    let active = true;
    void fetch("/api/teacher-profile")
      .then(async (response) => {
        const result = await response.json() as { isCompanyOwner?: boolean; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load the teacher profile.");
        if (active) setIsCompanyOwner(result.isCompanyOwner === true);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load the teacher profile."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch(`/api/students${role === "teacher" ? "?scope=teacher" : ""}`)
      .then(async (response) => {
        const result = await response.json() as Student[] | { error?: string };
        if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not load students.");
        const studentList = result as Student[];
        if (active) {
          setStudents(studentList);
          if (studentList.length) setSelectedStudentId((current) => current || studentList[0].id);
        }
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load students."); });
    return () => { active = false; };
  }, [role]);

  useEffect(() => {
    if (!selectedStudentId) return;
    let active = true;
    void fetch(`/api/sessions?studentId=${encodeURIComponent(selectedStudentId)}${role === "teacher" ? "&scope=teacher" : ""}`)
      .then(async (response) => {
        const result = await response.json() as PracticeSession[] | { error?: string };
        if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not load sessions.");
        if (active) setSessions(result as PracticeSession[]);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load sessions."); });
    return () => { active = false; };
  }, [selectedStudentId, role]);

  useEffect(() => {
    if (!selectedSessionId) return;
    let active = true;
    void fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}`)
      .then(async (response) => {
        const result = await response.json() as SessionSnapshot | { error?: string };
        if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not load this session.");
        if (active) setSnapshot(result as SessionSnapshot);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load this session."); });
    return () => { active = false; };
  }, [selectedSessionId]);

  async function refreshStudents(selectId?: string) {
    const response = await fetch(`/api/students${role === "teacher" ? "?scope=teacher" : ""}`);
    const result = await response.json() as Student[] | { error?: string };
    if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not load students.");
    const studentList = result as Student[];
    setStudents(studentList);
    if (selectId) setSelectedStudentId(selectId);
  }

  async function addStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newStudentName.trim();
    if (!name) return;
    setIsCreatingStudent(true);
    setError("");
    try {
      const response = await fetch("/api/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, organizationId: newStudentOrganizationId || null }) });
      const result = await response.json() as Student | { error?: string };
      if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not create this student.");
      setNewStudentName("");
      await refreshStudents((result as Student).id);
      setSelectedSessionId("");
      onSessionChange(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create this student."); }
    finally { setIsCreatingStudent(false); }
  }

  async function saveCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyName.trim()) return;
    setIsSavingCompany(true);
    setError("");
    try {
      const response = await fetch("/api/teacher-organization", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: companyName.trim(), type: companyType }),
      });
      const result = await response.json() as { organization?: TeacherOrganization; error?: string };
      if (!response.ok || !result.organization) throw new Error(result.error || "Could not save the teacher company.");
      setTeacherOrganization(result.organization);
      setCompanyName(result.organization.name);
      setNewStudentOrganizationId(result.organization.id);
      await refreshStudents();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save the teacher company."); }
    finally { setIsSavingCompany(false); }
  }

  async function saveOwnerStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingOwnerStatus(true);
    setError("");
    try {
      const response = await fetch("/api/teacher-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompanyOwner }),
      });
      const result = await response.json() as { isCompanyOwner?: boolean; error?: string };
      if (!response.ok || typeof result.isCompanyOwner !== "boolean") throw new Error(result.error || "Could not save the teacher profile.");
      setIsCompanyOwner(result.isCompanyOwner);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save the teacher profile."); }
    finally { setIsSavingOwnerStatus(false); }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setInviteLink("");
    try {
      const response = await fetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail, role: inviteRole, studentId: inviteRole === "student" ? inviteStudentId : null }) });
      const result = await response.json() as { token?: string; error?: string };
      if (!response.ok || !result.token) throw new Error(result.error || "Could not create invitation.");
      setInviteLink(`${window.location.origin}/invitations/${result.token}`); setInviteEmail("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create invitation."); }
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStudentId || !sessionDate || !location.trim()) return;
    setIsCreatingSession(true);
    setError("");
    try {
      const response = await fetch("/api/sessions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selectedStudentId, sessionDate, location: location.trim() }),
      });
      const result = await response.json() as PracticeSession | { error?: string };
      if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not create this session.");
      const session = result as PracticeSession;
      setSessions((current) => [session, ...current]);
      setSnapshot(null);
      setSelectedSessionId(session.id);
      onSessionChange(session);
      setSessionDate(today());
      setLocation("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create this session."); }
    finally { setIsCreatingSession(false); }
  }

  async function attachVideo() {
    if (!videoFile || !selectedSessionId) return;
    setIsAttachingVideo(true);
    setError("");
    try {
      const form = new FormData();
      form.set("video", videoFile, videoFile.name);
      const response = await fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}/videos`, { method: "POST", body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not attach this video.");
      const refreshed = await fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}`);
      const data = await refreshed.json() as SessionSnapshot | { error?: string };
      if (!refreshed.ok) throw new Error("error" in data && data.error ? data.error : "Video attached but session details could not refresh.");
      setSnapshot(data as SessionSnapshot);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not attach this video."); }
    finally { setIsAttachingVideo(false); }
  }

  function selectStudent(studentId: string) {
    setSelectedStudentId(studentId);
    setSessions([]);
    setSelectedSessionId("");
    setSnapshot(null);
    setError("");
    onSessionChange(null);
  }

  function selectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    setError("");
    onSessionChange(sessions.find((session) => session.id === sessionId) ?? null);
  }

  return <section className="session-panel">
    <div className="session-panel-header"><div><div className="eyebrow muted">PRACTICE RECORD</div><h3>{role === "teacher" ? "Students & sessions" : "Your sessions"}</h3></div><span className="sample-tag">LOCAL PROFILE</span></div>
    <div className="session-selectors">
      {role === "teacher" ? <label>Student profile<select value={selectedStudentId} onChange={(event) => selectStudent(event.target.value)}><option value="">Choose student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.name}{student.organizationName ? ` · ${student.organizationName}` : " · AI only"}</option>)}</select></label> : <div className="session-profile-display"><span>Student profile</span><strong>{selectedStudent?.name ?? "No student profile"}</strong></div>}
      <label>Session<select value={selectedSessionId} onChange={(event) => selectSession(event.target.value)} disabled={!selectedStudentId}><option value="">Choose session</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.sessionDate} · {session.location}</option>)}</select></label>
    </div>
    {role === "teacher" && <div className="session-create-forms">
      <form className="company-form" onSubmit={saveCompany}>
        <label>Company name<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Studio or private company" maxLength={160} required/></label>
        <label>Company type<select value={companyType} onChange={(event) => setCompanyType(event.target.value as CompanyType)}><option value="studio">Dance studio</option><option value="private_company">Private company</option><option value="other">Other</option></select></label>
        <button className="button button-dark" disabled={isSavingCompany || !companyName.trim()}>{isSavingCompany ? "Saving…" : teacherOrganization ? "Update company" : "Associate company"}</button>
        <span className="company-association-note">Associated with this local Teacher profile.</span>
      </form>
      <form className="owner-status-form" onSubmit={saveOwnerStatus}>
        <label><input type="checkbox" checked={isCompanyOwner} onChange={(event) => setIsCompanyOwner(event.target.checked)}/><span><strong>Company owner</strong><small>This role is saved for future portal permissions.</small></span></label>
        <button className="button button-outline" disabled={isSavingOwnerStatus}>{isSavingOwnerStatus ? "Saving…" : "Save teacher role"}</button>
      </form>
      {isCompanyOwner && teacherOrganization && <div className="company-member-list"><strong>{teacherOrganization.name} team</strong>{companyMembers.length ? companyMembers.map((member) => <div key={member.userId}><span>{member.name}</span><small>{member.role}</small></div>) : <p>No other company members have joined yet.</p>}</div>}
      {isCompanyOwner && teacherOrganization && <form className="invite-form" onSubmit={createInvite}><strong>Invite a person</strong><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="person@example.com" required/><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "teacher" | "student")}><option value="teacher">Teacher</option><option value="student">Student</option></select>{inviteRole === "student" && <select value={inviteStudentId} onChange={(event) => setInviteStudentId(event.target.value)} required><option value="">Choose student profile</option>{students.filter((student) => student.organizationId === teacherOrganization.id).map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select>}<button className="button button-outline" disabled={!inviteEmail || (inviteRole === "student" && !inviteStudentId)}>Create invitation</button>{inviteLink && <p className="invite-link">Share this link: <a href={inviteLink}>{inviteLink}</a></p>}</form>}
      <form className="inline-form" onSubmit={addStudent}>
        <label>New student<input value={newStudentName} onChange={(event) => setNewStudentName(event.target.value)} placeholder="Student name" maxLength={100}/></label>
        <label>Company (optional)<select value={newStudentOrganizationId} onChange={(event) => setNewStudentOrganizationId(event.target.value)}><option value="">No company — AI only</option>{teacherOrganization && <option value={teacherOrganization.id}>{teacherOrganization.name}</option>}</select></label>
        <button className="button button-dark" disabled={isCreatingStudent || !newStudentName.trim()}>{isCreatingStudent ? "Saving…" : "Add student"}</button>
      </form>
      <form className="inline-form session-form" onSubmit={createSession}><label>Session date<input type="date" value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} required/></label><label>Location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Studio, school, or online" maxLength={160} required/></label><button className="button button-dark" disabled={isCreatingSession || !selectedStudentId || !location.trim()}>{isCreatingSession ? "Creating…" : "New session"}</button></form>
    </div>}
    {role === "student" && selectedStudentId && <form className="inline-form session-form" onSubmit={createSession}><label>Session date<input type="date" value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} required/></label><label>Location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Studio, school, or online" maxLength={160} required/></label><button className="button button-dark" disabled={isCreatingSession || !location.trim()}>{isCreatingSession ? "Creating…" : "New session"}</button></form>}
    {role === "student" && !students.length && <p className="session-empty">No student profile is linked to this account yet. Ask your teacher to send a student invitation.</p>}
    {selectedSessionId && <div className="session-details">
      {snapshot ? <><div className="session-detail-heading"><strong>{snapshot.session.studentName} · {snapshot.session.sessionDate}</strong><span>{snapshot.session.location}</span></div>
        {snapshot.videos.length > 0 && <div className="session-linked-videos"><strong>Videos in this session</strong>{snapshot.videos.map((video) => <span key={video.hash}>▸ {video.filename}</span>)}</div>}
        {snapshot.aiCritiques.length > 0 && <div className="session-ai-notes"><strong>AI feedback for session videos</strong>{snapshot.aiCritiques.map((entry) => <article key={entry.key}><p>{entry.critique.comparison || entry.critique.summary}</p><ul>{entry.critique.observations.map((note, index) => <li key={`${entry.key}-${index}`}>{note.timestampSeconds !== null ? `${note.timestampSeconds.toFixed(1)}s · ` : ""}<b>{note.area}:</b> {note.observation}</li>)}</ul></article>)}</div>}
      </> : <p className="session-empty">Loading session details…</p>}
      {role === "teacher" && videoFile && <button className="button button-outline" onClick={attachVideo} disabled={isAttachingVideo}>{isAttachingVideo ? "Attaching video…" : "Attach selected video to this session"}</button>}
    </div>}
    {!selectedSessionId && role === "teacher" && <p className="session-empty">Create a student profile, then create a dated session with its location. A video is optional.</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <ConnectionPanel role={role} onAccepted={() => { void refreshStudents(); }} />
  </section>;
}
