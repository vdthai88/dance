"use client";

import { FormEvent, useEffect, useState } from "react";

type CompanyType = "studio" | "private_company" | "other";
type Company = { id: string; name: string; type: CompanyType };
type JoinRequest = { id: string; companyId: string; companyName: string; requesterName: string; requestedAt: string };

export function CompanyAssociationPanel({ onChanged }: { onChanged?: () => void }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<CompanyType>("studio");
  const [companyId, setCompanyId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [companyResponse, requestResponse] = await Promise.all([fetch("/api/companies", { cache: "no-store" }), fetch("/api/company-join-requests", { cache: "no-store" })]);
    const companyData = await companyResponse.json() as Company[] | { error?: string };
    const requestData = await requestResponse.json() as JoinRequest[] | { error?: string };
    if (!companyResponse.ok) throw new Error("Could not load companies.");
    if (!requestResponse.ok) throw new Error("Could not load company requests.");
    setCompanies(companyData as Company[]); setRequests(requestData as JoinRequest[]);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load company information.")); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!name.trim()) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), type }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not create the company.");
      setName(""); setMessage("Company created. You are its Owner."); await load(); onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the company."); }
    finally { setSaving(false); }
  }

  async function requestJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!companyId) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/company-join-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not send the join request.");
      setCompanyId(""); setMessage("Join request sent. A company Owner or Admin must approve it.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not send the join request."); }
    finally { setSaving(false); }
  }

  async function decideRequest(id: string, accept: boolean) {
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/company-join-requests/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not update the join request.");
      setMessage(accept ? "Teacher joined the company." : "Join request declined."); await load(); onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update the join request."); }
    finally { setSaving(false); }
  }

  return <section className="profile-form company-association-panel">
    <div className="profile-wide"><div className="eyebrow muted">COMPANY</div><h2>Company association</h2><p>Create a new company you own, or request to join an existing company.</p></div>
    <div className="profile-wide profile-switch company-mode-switch"><button type="button" className={mode === "create" ? "selected" : ""} onClick={() => setMode("create")}>Create company</button><button type="button" className={mode === "join" ? "selected" : ""} onClick={() => setMode("join")}>Request to join</button></div>
    {mode === "create" ? <form className="inline-form profile-wide" onSubmit={createCompany}><label>Company name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Studio or private company" maxLength={160} required/></label><label>Company type<select value={type} onChange={(event) => setType(event.target.value as CompanyType)}><option value="studio">Dance studio</option><option value="private_company">Private company</option><option value="other">Other</option></select></label><button className="button button-dark" disabled={saving || !name.trim()}>{saving ? "Saving..." : "Create company"}</button></form> : <form className="inline-form profile-wide" onSubmit={requestJoin}><label>Existing company<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required><option value="">Choose a company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><button className="button button-dark" disabled={saving || !companyId}>{saving ? "Sending..." : "Request to join"}</button></form>}
    {requests.length > 0 && <div className="profile-wide company-join-requests"><strong>Company join requests</strong>{requests.map((request) => <div key={request.id}><span><b>{request.requesterName}</b> wants to join {request.companyName}</span><div><button type="button" onClick={() => void decideRequest(request.id, true)} disabled={saving}>Accept</button><button type="button" onClick={() => void decideRequest(request.id, false)} disabled={saving}>Decline</button></div></div>)}</div>}
    {message && <p className="profile-wide" role="status">{message}</p>}
  </section>;
}
