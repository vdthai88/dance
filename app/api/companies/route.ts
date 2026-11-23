import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { createPgCompanyForTeacher, listPgCompanies, listPgOwnedCompanies } from "../../lib/postgres-organization-store";
import { createCompanyForTeacher, listCompanies, listOwnedCompanies } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (new URL(request.url).searchParams.get("owned") === "true") {
    if (!user) return NextResponse.json({ error: "Sign in to view your companies." }, { status: 401 });
    return NextResponse.json(usesPostgres() ? await listPgOwnedCompanies(user.id) : listOwnedCompanies(user.id), { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(usesPostgres() ? await listPgCompanies() : listCompanies(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to create a company." }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: unknown; type?: unknown; address?: unknown; phoneNumber?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const type = body?.type;
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  if (!name || name.length > 160 || address.length > 240 || phoneNumber.length > 40 || (type !== "studio" && type !== "private_company" && type !== "other")) return NextResponse.json({ error: "Enter a valid company name, type, address, and phone number." }, { status: 400 });
  const company = usesPostgres() ? await createPgCompanyForTeacher(user.id, { name, type, address, phoneNumber }) : createCompanyForTeacher(user.id, { name, type, address, phoneNumber });
  if (company === "exists") return NextResponse.json({ error: "That company already exists. Use Request to join instead." }, { status: 409 });
  return NextResponse.json({ company }, { status: 201 });
}
