"use client";

import { FormEvent, useEffect, useState } from "react";
import { ConnectionPanel } from "./connection-panel";
import { TeacherStudentsPanel } from "./teacher-students-panel";
import { IncomingRosterInvites } from "./incoming-roster-invites";
import { CompanyAssociationPanel } from "./company-association-panel";
import { ProPreview } from "./pro-preview";
import { ProfileSection } from "./profile-section";
import type { ProTrial } from "../lib/pro-trial-types";

type StudentCompany = { id: string; name: string; type: "studio" | "private_company" | "other" };
type TeacherCompany = StudentCompany & { isDefault?: boolean };
type Profile = { firstName: string; lastName: string; organizationName: string; birthYear: number | null; email?: string; roles?: string[]; companies?: StudentCompany[]; proTrial?: ProTrial | null };
type CompanyType = "studio" | "private_company" | "other";
type TeacherOrganization = { id: string; name: string; type: CompanyType };
const emptyProfile: Profile = { firstName: "", lastName: "", organizationName: "", birthYear: null };

async function readProfileResponse(response: Response) {
  const text = await response.text();
  if (!text) throw new Error("The Profile service returned an empty response. Restart npm run dev, then refresh this page.");
  try { return JSON.parse(text) as Profile & { error?: string }; }
  catch { throw new Error("The Profile service returned an invalid response. Restart npm run dev, then refresh this page."); }
}

export function ProfilePage({ required = false, onComplete, teacherCompanies = [], onDefaultStudio, onCompaniesChanged }: { required?: boolean; onComplete?: () => void; teacherCompanies?: TeacherCompany[]; onDefaultStudio?: (companyId: string) => void; onCompaniesChanged?: () => void }) {
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [teacherOrganization, setTeacherOrganization] = useState<TeacherOrganization | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState<CompanyType>("studio");
  const [savingCompany, setSavingCompany] = useState(false);
  const estimatedAge = profile.birthYear ? new Date().getFullYear() - profile.birthYear : null;
  const canManageCompany = profile.roles?.includes("teacher");
  const isStudent = profile.roles?.includes("student");

  function refreshProfile() {
    void fetch("/api/profile", { cache: "no-store" }).then(async (response) => {
      const data = await readProfileResponse(response);
      if (!response.ok) throw new Error(data.error || "Could not refresh profile.");
      setProfile(data);
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not refresh profile."));
  }

  useEffect(() => {
    void fetch("/api/profile").then(async (response) => {
      const data = await readProfileResponse(response);
      if (!response.ok) throw new Error(data.error || "Could not load profile.");
      setProfile(data);
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load profile."));
  }, []);

  useEffect(() => {
    if (!canManageCompany) return;
    void fetch("/api/teacher-organization", { cache: "no-store" }).then(async (response) => {
      const data = await response.json() as { organization?: TeacherOrganization | null; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load the company.");
      if (data.organization) {
        setTeacherOrganization(data.organization);
        setCompanyName(data.organization.name);
        setCompanyType(data.organization.type);
      }
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load the company."));
  }, [canManageCompany]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
      const data = await readProfileResponse(response);
      if (response.ok) { setProfile((current) => ({ ...current, ...data })); setMessage("Profile saved."); onComplete?.(); }
      else setMessage(data.error || "Could not save profile.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save profile."); }
    finally { setSaving(false); }
  }

  async function saveCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyName.trim()) return;
    setSavingCompany(true); setMessage("");
    try {
      const response = await fetch("/api/teacher-organization", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: companyName.trim(), type: companyType }) });
      const data = await response.json() as { organization?: TeacherOrganization; error?: string };
      if (!response.ok || !data.organization) throw new Error(data.error || "Could not save the company.");
      setTeacherOrganization(data.organization);
      setCompanyName(data.organization.name);
      setCompanyType(data.organization.type);
      setMessage("Company association saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the company."); }
    finally { setSavingCompany(false); }
  }

  return <section className="workspace profile-workspace" id="profile">
    <div className="profile-heading"><div className="eyebrow muted">PROFILE</div><h1>{required ? "Complete your profile." : "Your details."}</h1><p className={required ? "profile-required-message" : undefined} role={required ? "alert" : undefined}>{required ? "First and last name are required before you can continue." : "Keep your account information up to date."}</p></div>
    <form className="profile-form" onSubmit={save}>
      <div className="account-details account-details-with-pro profile-wide"><div><span>Email address</span><strong>{profile.email || "Loading..."}</strong></div><div><span>Assigned roles</span><p>{profile.roles?.length ? profile.roles.map((role) => <b key={role}>{role}</b>) : "No roles assigned"}</p></div><ProPreview trial={profile.proTrial} onStarted={refreshProfile} /></div>
      <label>First Name<input value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} maxLength={100} required/></label>
      <label>Last Name<input value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })} maxLength={100} required/></label>
      <label>Birth year<input type="number" inputMode="numeric" min="1900" max={new Date().getFullYear()} value={profile.birthYear ?? ""} onChange={(event) => setProfile({ ...profile, birthYear: event.target.value ? Number(event.target.value) : null })}/></label>
      <label>Estimated age<input value={estimatedAge === null ? "Enter birth year" : String(estimatedAge)} readOnly aria-readonly="true"/></label>
      <div className="profile-actions"><button className="button button-dark" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button>{message && <p role="status">{message}</p>}</div>
    </form>
    {false && canManageCompany && <form className="profile-form company-form" onSubmit={saveCompany}>
      <div className="profile-wide"><div className="eyebrow muted">COMPANY</div><h2>{teacherOrganization ? "Your company" : "Associate a company"}</h2><p>Connect your Teacher profile to a studio, private company, or other organization.</p></div>
      <label>Company name<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Studio or private company" maxLength={160} required/></label>
      <label>Company type<select value={companyType} onChange={(event) => setCompanyType(event.target.value as CompanyType)}><option value="studio">Dance studio</option><option value="private_company">Private company</option><option value="other">Other</option></select></label>
      <div className="profile-actions"><button className="button button-dark" disabled={savingCompany || !companyName.trim()}>{savingCompany ? "Saving..." : teacherOrganization ? "Update company" : "Associate company"}</button></div>
      {profile.companies?.length ? <div className="profile-wide"><strong>Company associations</strong><ul className="profile-company-list">{profile.companies?.map((company) => <li key={company.id}>{company.name} <small>{company.type.replace("_", " ")}</small></li>)}</ul></div> : null}
    </form>}
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
