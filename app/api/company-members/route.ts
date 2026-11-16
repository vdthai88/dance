import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { listPgCompanyMembers } from "../../lib/postgres-organization-store";
import { listCompanyMembers } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view company members." }, { status: 401 });
    return NextResponse.json(usesPostgres() ? await listPgCompanyMembers(user.id) : listCompanyMembers(user.id));
  } catch (error) {
    console.error("Could not list company members:", error);
    return NextResponse.json({ error: "The company member list could not be loaded." }, { status: 500 });
  }
}
