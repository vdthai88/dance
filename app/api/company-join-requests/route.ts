import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { listPgPendingCompanyJoinRequests, requestPgCompanyJoin } from "../../lib/postgres-organization-store";
import { listPendingCompanyJoinRequests, requestCompanyJoin } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return NextResponse.json(usesPostgres() ? await listPgPendingCompanyJoinRequests(user.id) : listPendingCompanyJoinRequests(user.id), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => null) as { companyId?: unknown } | null;
  const companyId = typeof body?.companyId === "string" ? body.companyId : "";
  const result = usesPostgres() ? await requestPgCompanyJoin(user.id, companyId) : requestCompanyJoin(user.id, companyId);
  if (result === "created") return NextResponse.json({ ok: true }, { status: 201 });
  return NextResponse.json({ error: result === "already_member" ? "You are already associated with this company." : result === "already_requested" ? "A join request is already pending for this company." : "Company not found." }, { status: result === "missing" ? 404 : 409 });
}
