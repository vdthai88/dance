"use client";

import { useCallback, useEffect, useState } from "react";
import { readApiJson } from "../lib/api-response";

type Option = { type: "teacher" | "company"; id: string; name: string; companyName: string | null };
type RequestItem = { id: string; studentName: string; targetName: string; targetType: "teacher" | "company"; requestedAt: string };

export function ConnectionPanel({ role, onAccepted }: { role: "student" | "teacher"; onAccepted?: () => void }) {
  const [options, setOptions] = useState<Option[]>([]);
  const [pending, setPending] = useState<RequestItem[]>([]);
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (role === "student") {
      const [optionData, pendingData] = await Promise.all([
        fetch("/api/connections", { cache: "no-store" }).then((response) => readApiJson(response, "Connections", "Could not load connection options.")),
        fetch("/api/connections?pending=student", { cache: "no-store" }).then((response) => readApiJson(response, "Pending requests", "Could not load pending requests.")),
      ]);
      setOptions(optionData as Option[]); setPending(pendingData as RequestItem[]); return;
    }
    const response = await fetch("/api/connections?pending=true", { cache: "no-store" });
    setPending(await readApiJson(response, "Student requests", "Could not load student connection requests.") as RequestItem[]);
  }, [role]);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load connections.")); }, 0); return () => window.clearTimeout(timer); }, [load]);
  async function request() {
    if (!target) return;
    const [type, targetId] = target.split(":");
    try {
      const response = await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, targetId }) });
      await readApiJson(response, "Send connection request", "Could not confirm that the request was sent.");
      setTarget("");
      setMessage("Request sent for approval.");
      try { await load(); } catch { setMessage("Request sent. Refresh your profile to update pending requests."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not send request."); }
  }
  async function decide(id: string, accept: boolean) {
    try {
      const response = await fetch(`/api/connections/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept }) });
      await readApiJson(response, "Update connection request", "Could not update the connection request.");
      setPending((current) => current.filter((item) => item.id !== id));
      setMessage(accept ? "Student connected." : "Request declined.");
      if (accept) onAccepted?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update request."); }
  }
  async function cancelRequest(id: string) { setCancellingId(id); setMessage(""); try { const response = await fetch(`/api/connections/${id}`, { method: "DELETE" }); if (!response.ok) { const data = await response.json().catch(() => null) as { error?: string } | null; throw new Error(data?.error || "Could not cancel this request."); } setPending((current) => current.filter((item) => item.id !== id)); setMessage("Request cancelled."); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not cancel this request."); } finally { setCancellingId(null); } }
  const teachers = options.filter((option) => option.type === "teacher");
  const companies = options.filter((option) => option.type === "company");
  const groups = new Map<string, Option[]>();
  for (const teacher of teachers) { const group = teacher.companyName || "No Company"; groups.set(group, [...(groups.get(group) ?? []), teacher]); }
  if (role === "student") return <div className="connection-panel"><strong>Connect with a teacher or studio</strong><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Choose a teacher or company</option>{companies.length > 0 && <optgroup label="Studios / Companies">{companies.map((company) => <option key={`company-${company.id}`} value={`company:${company.id}`}>{company.name}</option>)}</optgroup>}{[...groups.entries()].map(([companyName, teachersInCompany]) => <optgroup key={companyName} label={companyName}>{teachersInCompany.map((teacher) => <option key={`teacher-${teacher.id}-${companyName}`} value={`teacher:${teacher.id}`}>  {teacher.name}</option>)}</optgroup>)}</select><button className="button button-outline" type="button" onClick={request} disabled={!target}>Send request</button>{pending.length > 0 && <div className="connection-pending"><strong>Pending requests</strong>{pending.map((item) => <div className="student-pending-request" key={item.id}><span>Awaiting {item.targetType === "company" ? "company" : "teacher"}: <b>{item.targetName}</b><small>Requested {new Date(item.requestedAt.replace(" ", "T") + (item.requestedAt.endsWith("Z") ? "" : "Z")).toLocaleString()}</small></span><button type="button" onClick={() => void cancelRequest(item.id)} disabled={cancellingId === item.id}>{cancellingId === item.id ? "Cancelling..." : "Cancel request"}</button></div>)}</div>}{message && <p>{message}</p>}</div>;
  return <div className="connection-panel"><strong>Student connection requests</strong>{pending.length ? pending.map((item) => <div className="connection-request" key={item.id}><span>{item.studentName} → {item.targetType} {item.targetName}</span><button type="button" onClick={() => decide(item.id, true)}>Accept</button><button type="button" onClick={() => decide(item.id, false)}>Decline</button></div>) : <p>No pending requests.</p>}{message && <p>{message}</p>}</div>;
}
