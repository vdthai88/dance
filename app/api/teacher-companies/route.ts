import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { listPgTeacherCompanies, setPgDefaultTeacherCompany } from "../../lib/postgres-profile-store";
import { listTeacherCompanies, setDefaultTeacherCompany } from "../../lib/session-store";
export const runtime = "nodejs";
export async function GET(request: Request) { const user = await getAuthenticatedUser(request); if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 }); return NextResponse.json(usesPostgres() ? await listPgTeacherCompanies(user.id) : listTeacherCompanies(user.id), { headers: { "Cache-Control": "no-store" } }); }
export async function PATCH(request: Request) { const user = await getAuthenticatedUser(request); if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 }); const body = await request.json().catch(() => null) as { companyId?: unknown } | null; const companyId = typeof body?.companyId === "string" ? body.companyId : ""; const updated = usesPostgres() ? await setPgDefaultTeacherCompany(user.id, companyId) : setDefaultTeacherCompany(user.id, companyId); return updated ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Choose one of your company associations." }, { status: 403 }); }
