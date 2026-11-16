import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { usesPostgres } from "../../../lib/database-driver";
import { decidePgCompanyJoinRequest } from "../../../lib/postgres-organization-store";
import { decideCompanyJoinRequest } from "../../../lib/session-store";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { accept?: unknown } | null;
  if (typeof body?.accept !== "boolean") return NextResponse.json({ error: "Choose whether to accept the request." }, { status: 400 });
  const updated = usesPostgres() ? await decidePgCompanyJoinRequest(user.id, id, body.accept) : decideCompanyJoinRequest(user.id, id, body.accept);
  return updated ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "You cannot manage this request." }, { status: 403 });
}
