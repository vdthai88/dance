"use client";

import { FormEvent, useEffect, useState } from "react";
import { ConnectionPanel } from "./connection-panel";
import { TeacherStudentsPanel } from "./teacher-students-panel";
import { IncomingRosterInvites } from "./incoming-roster-invites";
import { CompanyAssociationPanel } from "./company-association-panel";
import { ProPreview } from "./pro-preview";
import { ProfileSection } from "./profile-section";
import { readApiJson } from "../lib/api-response";
import type { ProTrial } from "../lib/pro-trial-types";

type StudentCompany = { id: string; name: string; type: "studio" | "private_company" | "other" };
type TeacherCompany = StudentCompany & { isDefault?: boolean };
type Profile = { firstName: string; lastName: string; organizationName: string; birthYear: number | null; email?: string; roles?: string[]; companies?: StudentCompany[]; proTrial?: ProTrial | null };
const emptyProfile: Profile = { firstName: "", lastName: "", organizationName: "", birthYear: null };

async function loadProfile(signal?: AbortSignal) {
  const response = await fetch("/api/profile", { cache: "no-store", signal });
  return await readApiJson(response, "Profile", "Could not load your profile.") as Profile;
}

export function ProfilePage({ required = false, onComplete, teacherCompanies = [], onDefaultStudio, onCompaniesChanged }: { required?: boolean; onComplete?: () => void; teacherCompanies?: TeacherCompany[]; onDefaultStudio?: (companyId: string) => void; onCompaniesChanged?: () => void }) {
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const estimatedAge = profile.birthYear ? new Date().getFullYear() - profile.birthYear : null;
  const canManageCompany = profile.roles?.includes("teacher");
  const isStudent = profile.roles?.includes("student");

  function refreshProfile() {
    void loadProfile().then(setProfile).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "Could not refresh your profile.");
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal).then((data) => {
      if (!controller.signal.aborted) setProfile(data);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load your profile.");
    });
    return () => controller.abort();
  }, [loadAttempt]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
      const data = await readApiJson(response, "Save profile", "Could not save your profile.") as Profile;
      setProfile((current) => ({ ...current, ...data }));
      setMessage("Profile saved.");
      onComplete?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save profile."); }
    finally { setSaving(false); }
  }

  return <section className="workspace profile-workspace" id="profile">
    <div className="profile-heading"><div className="eyebrow muted">PROFILE</div><h1>{required ? "Complete your profile." : "Your details."}</h1><p className={required ? "profile-required-message" : undefined} role={required ? "alert" : undefined}>{required ? "First and last name are required before you can continue." : "Keep your account information up to date."}</p></div>
    <form className="profile-form" onSubmit={save}>
      <div className="account-details account-details-with-pro profile-wide"><div><span>Email address</span><strong>{profile.email || (loadError ? "Unavailable" : "Loading...")}</strong></div><div><span>Assigned roles</span><p>{profile.roles?.length ? profile.roles.map((role) => <b key={role}>{role}</b>) : profile.email ? "No roles assigned" : loadError ? "Unavailable" : "Loading..."}</p></div>{profile.email && <ProPreview trial={profile.proTrial} onStarted={refreshProfile} />}</div>
      <label>First Name<input value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} maxLength={100} required/></label>
      <label>Last Name<input value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })} maxLength={100} required/></label>
      <label>Birth year<input type="number" inputMode="numeric" min="1900" max={new Date().getFullYear()} value={profile.birthYear ?? ""} onChange={(event) => setProfile({ ...profile, birthYear: event.target.value ? Number(event.target.value) : null })}/></label>
      <label>Estimated age<input value={estimatedAge === null ? "Enter birth year" : String(estimatedAge)} readOnly aria-readonly="true"/></label>
      <div className="profile-actions"><button className="button button-dark" disabled={saving || !profile.email}>{saving ? "Saving..." : "Save profile"}</button>{message && <p role="status">{message}</p>}</div>
      {loadError && <div className="profile-wide"><p role="alert" className="auth-error">{loadError}</p><button type="button" className="button button-outline" onClick={() => { setLoadError(""); setLoadAttempt((current) => current + 1); }}>Retry loading profile</button></div>}
    </form>
    {canManageCompany && <CompanyAssociationPanel onChanged={() => { refreshProfile(); onCompaniesChanged?.(); }}>
      {teacherCompanies.length > 0 && <div className="profile-wide">
        <p>Choose one default studio for the next time you sign in.</p>
        <ul className="profile-company-list profile-company-defaults">
          {teacherCompanies.map((company) => <li key={company.id}>
            <label><input type="checkbox" checked={company.isDefault === true} onChange={() => onDefaultStudio?.(company.id)} /><span>{company.name}</span></label>
            <small>{company.type.replace("_", " ")}</small>
          </li>)}
        </ul>
      </div>}
    </CompanyAssociationPanel>}
    {canManageCompany && <TeacherStudentsPanel studios={teacherCompanies} />}
    {profile.roles && !isStudent && <IncomingRosterInvites separate onAccepted={() => { refreshProfile(); onCompaniesChanged?.(); }} />}
    {isStudent && <ProfileSection title="Your connections" className="company-form">
      <IncomingRosterInvites onAccepted={() => { refreshProfile(); onCompaniesChanged?.(); }} />
      <div className="profile-wide"><p>{profile.companies?.length ? "You can belong to more than one studio or company." : "Request access to a teacher or company to connect."}</p>{profile.companies?.length ? <ul className="profile-company-list">{profile.companies?.map((company) => <li key={company.id}>{company.name} <small>{company.type.replace("_", " ")}</small></li>)}</ul> : null}</div>
      <div className="profile-wide"><ConnectionPanel role="student" /></div>
    </ProfileSection>}
  </section>;
}
