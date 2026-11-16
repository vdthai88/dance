import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { usesPostgres } from "../../../lib/database-driver";
import { getPgAccountRoles } from "../../../lib/postgres-profile-store";
import { getAccountRoles } from "../../../lib/session-store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to view account roles." }, { status: 401 });
  const roles = usesPostgres() ? await getPgAccountRoles(user.id) : getAccountRoles(user.id);
  return NextResponse.json({ roles });
}
