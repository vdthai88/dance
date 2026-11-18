import { NextRequest, NextResponse } from "next/server";
import { auth } from "./app/lib/auth";
import { usesPostgres } from "./app/lib/database-driver";
import { getPgAccountRoles, getPgUserProfile } from "./app/lib/postgres-profile-store";
import { getAccountRoles, getUserProfile } from "./app/lib/session-store";
import { accountEntryRedirect } from "./app/lib/account-landing";

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.redirect(new URL("/sign-in", request.url));
  const profile = usesPostgres()
    ? await getPgUserProfile(session.user.id)
    : getUserProfile(session.user.id);
  const roles = usesPostgres() ? await getPgAccountRoles(session.user.id) : getAccountRoles(session.user.id);
  const destination = accountEntryRedirect(profile, roles, request.nextUrl.searchParams);
  if (destination) return NextResponse.redirect(new URL(destination, request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
