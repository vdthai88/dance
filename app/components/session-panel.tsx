"use client";

import { useEffect, useRef, useState } from "react";
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
  name: string;
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

export function SessionPanel({ role, onRoleChange, onSessionChange, companyId }: {
  role: Role;
  onRoleChange: (role: Role) => void;
  onSessionChange: (session: PracticeSession | null) => void;
  companyId?: string | null;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [isCreatingNewSession, setIsCreatingNewSession] = useState(false);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [newStudentName, setNewStudentName] = useState("");
  const [newStudentOrganizationId, setNewStudentOrganizationId] = useState("");
  const [teacherOrganization, setTeacherOrganization] = useState<TeacherOrganization | null>(null);
  const [isCompanyOwner, setIsCompanyOwner] = useState(false);
  const [canUseTeacherMode, setCanUseTeacherMode] = useState(false);
  const [companyMembers, setCompanyMembers] = useState<CompanyMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"teacher" | "student">("teacher");
  const [inviteStudentId, setInviteStudentId] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState<CompanyType>("studio");
  const [sessionDate, setSessionDate] = useState(today);
  const [isCreatingStudent, setIsCreatingStudent] = useState(false);
  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [isSavingOwnerStatus, setIsSavingOwnerStatus] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isAttachingVideo, setIsAttachingVideo] = useState(false);
  const [isDraggingSessionVideo, setIsDraggingSessionVideo] = useState(false);
  const [uploadedVideoName, setUploadedVideoName] = useState("");
  const [error, setError] = useState("");
  const sessionVideoInput = useRef<HTMLInputElement>(null);
  const selectedStudent = students.find((student) => student.id === selectedStudentId);

  useEffect(() => {
    let active = true;
    void fetch("/api/account/roles")
      .then(async (response) => {
        const result = await response.json() as { roles?: string[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load account roles.");
        if (active) setCanUseTeacherMode(result.roles?.includes("teacher") || result.roles?.includes("admin") || false);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load account roles."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (role !== "teacher") return;
    let active = true;
    void fetch("/api/teacher-organization")
      .then(async (response) => {
        const result = await response.json() as { organization?: TeacherOrganization | null; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load the teacher company.");
        if (active && result.organization) {
          setTeacherOrganization(result.organization);
          setNewStudentOrganizationId(result.organization.id);
        }
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load the teacher company."); });
    return () => { active = false; };
  }, [role]);

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
    if (role !== "teacher") return;
    let active = true;
    void fetch("/api/teacher-profile")
      .then(async (response) => {
        const result = await response.json() as { isCompanyOwner?: boolean; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load the teacher profile.");
        if (active) setIsCompanyOwner(result.isCompanyOwner === true);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load the teacher profile."); });
    return () => { active = false; };
  }, [role]);

  useEffect(() => {
    let active = true;
    const scope = role === "teacher" ? `?scope=teacher${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ""}` : "";
    if (role === "teacher" && !companyId) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setStudents([]);
        setSelectedStudentId("");
      });
      return () => { active = false; };
    }
    void fetch(`/api/students${scope}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as Student[] | { error?: string };
        if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not load students.");
        const studentList = result as Student[];
        if (active) {
          setStudents(studentList);
          // A studio switch is a new coaching context. Clear every selection
          // from the prior context before choosing the first student available
          // in the newly selected studio.
          setSelectedStudentId(studentList[0]?.id ?? "");
          setSessions([]);
          setSelectedSessionId("");
          setIsCreatingNewSession(false);
          setSnapshot(null);
          setError("");
        }
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load students."); });
    return () => { active = false; };
  }, [role, companyId]);

  useEffect(() => {
    if (!selectedStudentId) return;
    let active = true;
    void fetch(`/api/sessions?studentId=${encodeURIComponent(selectedStudentId)}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ""}${role === "teacher" ? "&scope=teacher" : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as PracticeSession[] | { error?: string };
        if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not load sessions.");
        if (active) setSessions(result as PracticeSession[]);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load sessions."); });
    return () => { active = false; };
  }, [selectedStudentId, role, companyId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    let active = true;
    void fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as SessionSnapshot | { error?: string };
        if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not load this session.");
        if (active) setSnapshot(result as SessionSnapshot);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load this session."); });
    return () => { active = false; };
  }, [selectedSessionId]);

  async function refreshStudents(selectId?: string) {
    const response = await fetch(`/api/students${role === "teacher" ? `?scope=teacher${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ""}` : ""}`, { cache: "no-store" });
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
      setIsCreatingNewSession(false);
      onSessionChange(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create this student."); }
    finally { setIsCreatingStudent(false); }
  }

  async function saveCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyName.trim()) return;
    setIsSavingCompany(true);
    try {
      const response = await fetch("/api/teacher-organization", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: companyName.trim(), type: companyType }) });
      const result = await response.json() as { organization?: TeacherOrganization; error?: string };
      if (!response.ok || !result.organization) throw new Error(result.error || "Could not save the teacher company.");
      setTeacherOrganization(result.organization);
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

  async function createSession() {
    if (!selectedStudentId || !sessionDate || !companyId) return;
    setIsCreatingSession(true);
    setError("");
    try {
      const response = await fetch("/api/sessions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selectedStudentId, companyId, sessionDate, location: "" }),
      });
      const result = await response.json() as PracticeSession | { error?: string };
      if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not create this session.");
      const session = result as PracticeSession;
      setSessions((current) => [session, ...current]);
      setSnapshot(null);
      setSelectedSessionId(session.id);
      setIsCreatingNewSession(false);
      onSessionChange(session);
      setSessionDate(today());
    } catch (caught) { setIsCreatingNewSession(false); setError(caught instanceof Error ? caught.message : "Could not create this session."); }
    finally { setIsCreatingSession(false); }
  }

  async function attachVideo(video: File) {
    if (!selectedSessionId) return;
    setIsAttachingVideo(true);
    setError("");
    try {
      const form = new FormData();
      form.set("video", video, video.name);
      const response = await fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}/videos`, { method: "POST", body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not attach this video.");
      const refreshed = await fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}`, { cache: "no-store" });
      const data = await refreshed.json() as SessionSnapshot | { error?: string };
      if (!refreshed.ok) throw new Error("error" in data && data.error ? data.error : "Video attached but session details could not refresh.");
      setSnapshot(data as SessionSnapshot);
      setUploadedVideoName(video.name);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not attach this video."); }
    finally { setIsAttachingVideo(false); }
  }

  function requireSessionForVideo() {
    if (selectedSessionId) return true;
    setError("Please select an existing session or create a new one before uploading a video.");
    return false;
  }

  function chooseSessionVideo(video?: File | null) {
    if (!requireSessionForVideo() || !video) return;
    if (!video.type.startsWith("video/")) {
      setError("Choose a video file to upload.");
      return;
    }
    void attachVideo(video);
  }

  function selectStudent(studentId: string) {
    setSelectedStudentId(studentId);
    setSessions([]);
    setSelectedSessionId("");
    setIsCreatingNewSession(false);
    setSnapshot(null);
    setUploadedVideoName("");
    setError("");
    onSessionChange(null);
  }

  function selectSession(sessionId: string) {
    if (sessionId === "new") {
      setIsCreatingNewSession(true);
      setSelectedSessionId("");
      setSnapshot(null);
      setUploadedVideoName("");
      onSessionChange(null);
      void createSession();
      return;
    }
    setIsCreatingNewSession(false);
    setSelectedSessionId(sessionId);
    setUploadedVideoName("");
    setError("");
    onSessionChange(sessions.find((session) => session.id === sessionId) ?? null);
  }

  return <>
    <section className="session-panel">
    <div className="session-panel-header"><div><div className="eyebrow muted personal-space-label"><span className="eyebrow-dot" /> YOUR PERSONAL PRACTICE SPACE</div>{role === "teacher" && <h3>Students & sessions</h3>}</div><div className="profile-switch session-profile-switch" role="group" aria-label="Choose coaching profile"><button type="button" className={role === "student" ? "selected" : ""} onClick={() => onRoleChange("student")}>Student</button><button type="button" className={role === "teacher" ? "selected" : ""} onClick={() => onRoleChange("teacher")} disabled={!canUseTeacherMode} title={!canUseTeacherMode ? "This account does not have the Teacher role." : undefined}>Teacher</button></div></div>
    <div className="session-selectors">
      {role === "teacher" ? <label>Student profile<select value={selectedStudentId} onChange={(event) => selectStudent(event.target.value)}><option value="">Choose student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label> : <div className="session-profile-display"><strong>{selectedStudent?.name ?? "No student profile"}</strong></div>}
      <label>Sessions<select aria-label="Sessions" value={isCreatingNewSession ? "new" : selectedSessionId} onChange={(event) => selectSession(event.target.value)} disabled={!selectedStudentId || isCreatingSession}><option value="">Select session</option>{role === "teacher" && <option value="new">{isCreatingSession ? "Creating session..." : "Create new session"}</option>}{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select></label>
    </div>
    {role === "teacher" && <div className="session-create-forms">
      <form className="company-form" onSubmit={saveCompany} hidden style={{ display: "none" }}>
        <label>Company name<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Studio or private company" maxLength={160} required/></label>
        <label>Company type<select value={companyType} onChange={(event) => setCompanyType(event.target.value as CompanyType)}><option value="studio">Dance studio</option><option value="private_company">Private company</option><option value="other">Other</option></select></label>
        <button className="button button-dark" disabled={isSavingCompany || !companyName.trim()}>{isSavingCompany ? "Saving…" : teacherOrganization ? "Update company" : "Associate company"}</button>
        <span className="company-association-note">Associated with this local Teacher profile.</span>
      </form>
      <form className="owner-status-form" onSubmit={saveOwnerStatus} hidden style={{ display: "none" }}>
        <label><input type="checkbox" checked={isCompanyOwner} onChange={(event) => setIsCompanyOwner(event.target.checked)}/><span><strong>Company owner</strong><small>This role is saved for future portal permissions.</small></span></label>
        <button className="button button-outline" disabled={isSavingOwnerStatus}>{isSavingOwnerStatus ? "Saving…" : "Save teacher role"}</button>
      </form>
      <form className="inline-form" onSubmit={addStudent} hidden style={{ display: "none" }}>
        <label>New student<input value={newStudentName} onChange={(event) => setNewStudentName(event.target.value)} placeholder="Student name" maxLength={100}/></label>
        <label>Company (optional)<select value={newStudentOrganizationId} onChange={(event) => setNewStudentOrganizationId(event.target.value)}><option value="">No company — AI only</option>{teacherOrganization && <option value={teacherOrganization.id}>{teacherOrganization.name}</option>}</select></label>
        <button className="button button-dark" disabled={isCreatingStudent || !newStudentName.trim()}>{isCreatingStudent ? "Saving…" : "Add student"}</button>
      </form>
    </div>}
    {role === "student" && !students.length && <p className="session-empty">No student profile is linked to this account yet. Ask your teacher to send a student invitation.</p>}
    {selectedSessionId && <div className="session-details">
      {snapshot ? <><div className="session-detail-heading"><strong>{snapshot.session.name}</strong>{snapshot.session.location && <span>{snapshot.session.location}</span>}</div>
        {snapshot.videos.length > 0 && <div className="session-linked-videos"><strong>Videos in this session</strong>{snapshot.videos.map((video) => <div key={video.hash} className="session-stored-video"><span>▸ {video.filename}</span><video controls preload="metadata" src={`/api/sessions/${encodeURIComponent(snapshot.session.id)}/videos/${encodeURIComponent(video.hash)}`}>Your browser cannot play this video.</video></div>)}</div>}
        {snapshot.aiCritiques.length > 0 && <div className="session-ai-notes"><strong>AI feedback for session videos</strong>{snapshot.aiCritiques.map((entry) => <article key={entry.key}><p>{entry.critique.comparison || entry.critique.summary}</p><ul>{entry.critique.observations.map((note, index) => <li key={`${entry.key}-${index}`}>{note.timestampSeconds !== null ? `${note.timestampSeconds.toFixed(1)}s · ` : ""}<b>{note.area}:</b> {note.observation}</li>)}</ul></article>)}</div>}
      </> : <p className="session-empty">Loading session details…</p>}
    </div>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {false && role === "teacher" && <ConnectionPanel role="teacher" onAccepted={() => { void refreshStudents(); }} />}
    </section>
    {role === "teacher" && <section className={`session-video-upload${isDraggingSessionVideo ? " dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setIsDraggingSessionVideo(true); }} onDragLeave={() => setIsDraggingSessionVideo(false)} onDrop={(event) => { event.preventDefault(); setIsDraggingSessionVideo(false); chooseSessionVideo(event.dataTransfer.files[0]); }}>
      <input ref={sessionVideoInput} className="visually-hidden" type="file" accept="video/*" onChange={(event) => { chooseSessionVideo(event.target.files?.[0]); event.currentTarget.value = ""; }} aria-label="Upload video for this session"/>
      <div><div className="eyebrow muted">SESSION VIDEO</div><h3>Upload a practice video</h3><p>{selectedSessionId ? "This video will be saved to the selected session." : "Select an existing session or create a new one before uploading."}</p></div>
      <button className="button button-dark" type="button" onClick={() => { if (requireSessionForVideo()) sessionVideoInput.current?.click(); }} disabled={isAttachingVideo}>{isAttachingVideo ? "Uploading video…" : "Choose or drop video"}</button>
      {error && <p className="session-upload-error" role="alert">{error}</p>}
      {uploadedVideoName && <p className="session-upload-success" role="status">Added “{uploadedVideoName}” to this session.</p>}
    </section>
    }
  </>;
}
