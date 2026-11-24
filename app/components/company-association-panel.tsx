"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { readApiJson } from "../lib/api-response";
import { ProfileSection } from "./profile-section";

type CompanyType = "studio" | "private_company" | "other";
type Company = { id: string; name: string; type: CompanyType; address?: string | null; phoneNumber?: string | null };
type JoinRequest = { id: string; companyId: string; companyName: string; requesterName: string; requestedAt: string };

function OwnedCompanyForm({ company, onSaved }: { company: Company; onSaved: (company: Company) => void }) {
  const [name, setName] = useState(company.name);
  const [type, setType] = useState<CompanyType>(company.type);
  const [address, setAddress] = useState(company.address ?? "");
  const [phoneNumber, setPhoneNumber] = useState(company.phoneNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(company.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), type, address: address.trim(), phoneNumber: phoneNumber.trim() }) });
      const data = await readApiJson(response, "Save company", "Could not update the company.") as { company?: Company };
      if (!data.company) throw new Error("The company update could not be confirmed. Refresh the page to check.");
      onSaved(data.company); setMessage("Saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update the company."); }
    finally { setSaving(false); }
  }
  return <form className="owned-company-form" onSubmit={save}>
    <div className="owned-company-form-heading"><strong>{company.name}</strong><span>Owner</span></div>
    <label>Company name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required /></label>
    <label>Company type<select value={type} onChange={(event) => setType(event.target.value as CompanyType)}><option value="studio">Dance studio</option><option value="private_company">Private company</option><option value="other">Other</option></select></label>
    <label>Address<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street, city, province/state" maxLength={240} /></label>
    <label>Phone number<input type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="(555) 555-5555" maxLength={40} /></label>
    <div className="owned-company-form-actions"><button className="button button-dark" disabled={saving || !name.trim()}>{saving ? "Saving..." : "Save company"}</button>{message && <span role="status">{message}</span>}</div>
  </form>;
}

export function CompanyAssociationPanel({ onChanged, children }: { onChanged?: () => void; children?: ReactNode }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [ownedCompanies, setOwnedCompanies] = useState<Company[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<CompanyType>("studio");
  const [address, setAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    await Promise.all([
      fetch("/api/companies", { cache: "no-store" })
        .then((response) => readApiJson(response, "Company list", "Could not load companies."))
        .then((data) => setCompanies(data as Company[])),
      fetch("/api/company-join-requests", { cache: "no-store" })
        .then((response) => readApiJson(response, "Company requests", "Could not load company requests."))
        .then((data) => setRequests(data as JoinRequest[])),
      fetch("/api/companies?owned=true", { cache: "no-store" })
        .then((response) => readApiJson(response, "Your companies", "Could not load your companies."))
        .then((data) => setOwnedCompanies(data as Company[])),
    ]);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load company information.")); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!name.trim()) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), type, address: address.trim(), phoneNumber: phoneNumber.trim() }) });
      const { company } = await readApiJson(response, "Create company", "Could not confirm company creation. Refresh your profile to check before trying again.") as { company?: Company };
      if (!company) throw new Error("Company creation could not be confirmed. Refresh your profile to check before trying again.");
      setOwnedCompanies((current) => [...current.filter(({ id }) => id !== company.id), company].sort((a, b) => a.name.localeCompare(b.name)));
      setName(""); setAddress(""); setPhoneNumber("");
      setMessage("Company created. You are its Owner.");
      onChanged?.();
      try { await load(); }
      catch { setMessage("Company created. Refresh your profile to update the company lists."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the company."); }
    finally { setSaving(false); }
  }

  async function requestJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!companyId) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/company-join-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId }) });
      await readApiJson(response, "Join company", "Could not send the join request.");
      setCompanyId(""); setMessage("Join request sent. A company Owner or Admin must approve it.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not send the join request."); }
    finally { setSaving(false); }
  }

  async function decideRequest(id: string, accept: boolean) {
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/company-join-requests/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept }) });
      await readApiJson(response, "Company join request", "Could not update the join request.");
      setRequests((current) => current.filter((request) => request.id !== id));
      setMessage(accept ? "Teacher joined the company." : "Join request declined."); onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update the join request."); }
    finally { setSaving(false); }
  }

  return <ProfileSection title="Company association" className="company-association-panel">
    {children}
    <div className="profile-wide"><p>Create a new company you own, or request to join an existing company.</p></div>
    <div className="profile-wide profile-switch company-mode-switch"><button type="button" className={mode === "create" ? "selected" : ""} onClick={() => setMode("create")}>Create company</button><button type="button" className={mode === "join" ? "selected" : ""} onClick={() => setMode("join")}>Request to join</button></div>
    {mode === "create" ? <form className="inline-form profile-wide company-create-form" onSubmit={createCompany}><label>Company name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Studio or private company" maxLength={160} required/></label><label>Company type<select value={type} onChange={(event) => setType(event.target.value as CompanyType)}><option value="studio">Dance studio</option><option value="private_company">Private company</option><option value="other">Other</option></select></label><label>Address<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street, city, province/state" maxLength={240}/></label><label>Phone number<input type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="(555) 555-5555" maxLength={40}/></label><button className="button button-dark" disabled={saving || !name.trim()}>{saving ? "Saving..." : "Create company"}</button></form> : <form className="inline-form profile-wide" onSubmit={requestJoin}><label>Existing company<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required><option value="">Choose a company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><button className="button button-dark" disabled={saving || !companyId}>{saving ? "Sending..." : "Request to join"}</button></form>}
    {ownedCompanies.length > 0 && <ProfileSection title="Your companies" nested>
      {ownedCompanies.map((company) => <OwnedCompanyForm key={company.id} company={company} onSaved={(updated) => { setOwnedCompanies((current) => current.map((item) => item.id === updated.id ? updated : item)); onChanged?.(); }} />)}
    </ProfileSection>}
    {requests.length > 0 && <ProfileSection title={`Company join requests (${requests.length})`} nested>
      <div className="company-join-requests">{requests.map((request) => <div key={request.id}><span><b>{request.requesterName}</b> wants to join {request.companyName}</span><div><button type="button" onClick={() => void decideRequest(request.id, true)} disabled={saving}>Accept</button><button type="button" onClick={() => void decideRequest(request.id, false)} disabled={saving}>Decline</button></div></div>)}</div>
    </ProfileSection>}
    {message && <p className="profile-wide" role="status">{message}</p>}
  </ProfileSection>;
}
