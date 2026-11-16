import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { createPgCompanyForTeacher, listPgCompanies } from "../../lib/postgres-organization-store";
import { createCompanyForTeacher, listCompanies } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET() { return NextResponse.json(usesPostgres() ? await listPgCompanies() : listCompanies(), { headers: { "Cache-Control": "no-store" } }); }

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to create a company." }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: unknown; type?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const type = body?.type;
  if (!name || name.length > 160 || (type !== "studio" && type !== "private_company" && type !== "other")) return NextResponse.json({ error: "Enter a company name and type." }, { status: 400 });
  const company = usesPostgres() ? await createPgCompanyForTeacher(user.id, { name, type }) : createCompanyForTeacher(user.id, { name, type });
  if (company === "exists") return NextResponse.json({ error: "That company already exists. Use Request to join instead." }, { status: 409 });
  return NextResponse.json({ company }, { status: 201 });
}
