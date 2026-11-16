import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../../lib/auth-session";
import { usesPostgres } from "../../../../lib/database-driver";
import { choosePgAccountRole, getPgAccountRoles } from "../../../../lib/postgres-profile-store";
import { chooseAccountRole, getAccountRoles } from "../../../../lib/session-store";

export const runtime = "nodejs";

/** Assign Student only to an account that does not yet have any app role. */
export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in before completing your account." }, { status: 401 });
  const roles = usesPostgres() ? await getPgAccountRoles(user.id) : getAccountRoles(user.id);
  if (roles.length === 0) {
    if (usesPostgres()) await choosePgAccountRole(user.id, "student");
    else chooseAccountRole(user.id, "student");
    return NextResponse.json({ role: "student", assigned: true });
  }
  return NextResponse.json({ roles, assigned: false });
}
