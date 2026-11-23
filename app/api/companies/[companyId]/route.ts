import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { usesPostgres } from "../../../lib/database-driver";
import { updatePgOwnedCompany } from "../../../lib/postgres-organization-store";
import { updateOwnedCompany } from "../../../lib/session-store";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ companyId: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to update your company." }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: unknown; type?: unknown; address?: unknown; phoneNumber?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  const type = body?.type;
  if (!name || name.length > 160 || address.length > 240 || phoneNumber.length > 40 || (type !== "studio" && type !== "private_company" && type !== "other")) return NextResponse.json({ error: "Enter a valid company name, type, address, and phone number." }, { status: 400 });
  const { companyId } = await context.params;
  const updated = usesPostgres()
    ? await updatePgOwnedCompany(user.id, companyId, { name, type, address, phoneNumber })
    : updateOwnedCompany(user.id, companyId, { name, type, address, phoneNumber });
  if (updated === "exists") return NextResponse.json({ error: "That company name is already in use." }, { status: 409 });
  if (!updated) return NextResponse.json({ error: "Only the company Owner can update these details." }, { status: 403 });
  return NextResponse.json({ company: updated });
}
