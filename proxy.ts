import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "./app/lib/auth-session";
import { usesPostgres } from "./app/lib/database-driver";
import { getPgAccountRoles, getPgUserProfile } from "./app/lib/postgres-profile-store";
import { getAccountRoles, getUserProfile } from "./app/lib/session-store";
import { accountEntryRedirect } from "./app/lib/account-landing";

export async function proxy(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));
  const profile = usesPostgres()
    ? await getPgUserProfile(user.id)
    : getUserProfile(user.id);
  const roles = usesPostgres() ? await getPgAccountRoles(user.id) : getAccountRoles(user.id);
  const destination = accountEntryRedirect(profile, roles, request.nextUrl.searchParams);
  if (destination) return NextResponse.redirect(new URL(destination, request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
