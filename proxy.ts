import { NextRequest, NextResponse } from "next/server";
import { auth } from "./app/lib/auth";
import { usesPostgres } from "./app/lib/database-driver";
import { getPgUserProfile } from "./app/lib/postgres-profile-store";
import { getUserProfile } from "./app/lib/session-store";

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.redirect(new URL("/sign-in", request.url));
  const profile = usesPostgres()
    ? await getPgUserProfile(session.user.id)
    : getUserProfile(session.user.id);
  const isComplete = Boolean(profile.firstName.trim() && profile.lastName.trim());
  const isProfileSetup = request.nextUrl.searchParams.get("page") === "profile";
  if (!isComplete && !isProfileSetup) {
    return NextResponse.redirect(new URL("/?page=profile&required=1", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
