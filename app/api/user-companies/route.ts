import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { listPgStudentCompanies } from "../../lib/postgres-profile-store";
import { listStudentCompanies } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return NextResponse.json(usesPostgres() ? await listPgStudentCompanies(user.id) : listStudentCompanies(user.id), { headers: { "Cache-Control": "no-store" } });
}
