import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { usesPostgres } from "../../../lib/database-driver";
import { getPgAccountRoles, getPgUserProfile } from "../../../lib/postgres-profile-store";
import { getAccountRoles, getUserProfile } from "../../../lib/session-store";
import { accountLanding } from "../../../lib/account-landing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  // Read persisted names, not Google's unsaved profile-form suggestions.
  const [profile, roles] = usesPostgres()
    ? await Promise.all([getPgUserProfile(user.id), getPgAccountRoles(user.id)])
    : [getUserProfile(user.id), getAccountRoles(user.id)];
  return NextResponse.json({ destination: accountLanding(profile, roles) }, { headers: { "Cache-Control": "no-store" } });
}
