"use client";

import { useCallback, useEffect, useState } from "react";

type Option = { type: "teacher" | "company"; id: string; name: string; companyName: string | null };
type RequestItem = { id: string; studentName: string; targetName: string; targetType: "teacher" | "company"; requestedAt: string };

export function ConnectionPanel({ role, onAccepted }: { role: "student" | "teacher"; onAccepted?: () => void }) {
  const [options, setOptions] = useState<Option[]>([]);
  const [pending, setPending] = useState<RequestItem[]>([]);
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    if (role === "student") {
      const [optionResponse, pendingResponse] = await Promise.all([fetch("/api/connections", { cache: "no-store" }), fetch("/api/connections?pending=student", { cache: "no-store" })]);
      const optionData = await optionResponse.json() as Option[] | { error?: string };
      const pendingData = await pendingResponse.json() as RequestItem[] | { error?: string };
      if (!optionResponse.ok) throw new Error("error" in optionData && optionData.error ? optionData.error : "Could not load connection options.");
      if (!pendingResponse.ok) throw new Error("error" in pendingData && pendingData.error ? pendingData.error : "Could not load pending requests.");
      setOptions(optionData as Option[]); setPending(pendingData as RequestItem[]); return;
    }
    const response = await fetch("/api/connections?pending=true", { cache: "no-store" }); const data = await response.json() as RequestItem[] | { error?: string };
    if (!response.ok) throw new Error("error" in data && data.error ? data.error : "Could not load requests."); setPending(data as RequestItem[]);
  }, [role]);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load connections.")); }, 0); return () => window.clearTimeout(timer); }, [load]);
  async function request() { if (!target) return; const [type, targetId] = target.split(":"); const response = await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, targetId }) }); const data = await response.json() as { error?: string }; setMessage(response.ok ? "Request sent for approval." : data.error || "Could not send request."); if (response.ok) { setTarget(""); void load(); } }
  async function decide(id: string, accept: boolean) { const response = await fetch(`/api/connections/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept }) }); const data = await response.json() as { error?: string }; setMessage(response.ok ? (accept ? "Student connected." : "Request declined.") : data.error || "Could not update request."); if (response.ok) { void load(); if (accept) onAccepted?.(); } }
  const teachers = options.filter((option) => option.type === "teacher");
  const companies = options.filter((option) => option.type === "company");
  const groups = new Map<string, Option[]>();
  for (const teacher of teachers) { const group = teacher.companyName || "No Company"; groups.set(group, [...(groups.get(group) ?? []), teacher]); }
  if (role === "student") return <div className="connection-panel"><strong>Connect with a teacher or studio</strong><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Choose a teacher or company</option>{companies.length > 0 && <optgroup label="Studios / Companies">{companies.map((company) => <option key={`company-${company.id}`} value={`company:${company.id}`}>{company.name}</option>)}</optgroup>}{[...groups.entries()].map(([companyName, teachersInCompany]) => <optgroup key={companyName} label={companyName}>{teachersInCompany.map((teacher) => <option key={`teacher-${teacher.id}-${companyName}`} value={`teacher:${teacher.id}`}>  {teacher.name}</option>)}</optgroup>)}</select><button className="button button-outline" type="button" onClick={request} disabled={!target}>Send request</button>{pending.length > 0 && <div className="connection-pending"><strong>Pending requests</strong>{pending.map((item) => <span key={item.id}>Awaiting {item.targetType === "company" ? "company" : "teacher"}: {item.targetName}</span>)}</div>}{message && <p>{message}</p>}</div>;
  return <div className="connection-panel"><strong>Student connection requests</strong>{pending.length ? pending.map((item) => <div className="connection-request" key={item.id}><span>{item.studentName} → {item.targetType} {item.targetName}</span><button type="button" onClick={() => decide(item.id, true)}>Accept</button><button type="button" onClick={() => decide(item.id, false)}>Decline</button></div>) : <p>No pending requests.</p>}{message && <p>{message}</p>}</div>;
}
