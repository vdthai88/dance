import { NextResponse } from "next/server";
import { auth } from "../../../lib/auth";
import { callEmailAuth } from "../../../lib/email-auth-request";
import { stagingAccessError } from "../../../lib/staging-access";
import { rosterInviteTokenFromPath } from "../../../lib/roster-invite-links";
import { usesPostgres } from "../../../lib/database-driver";
import { decideRosterInvite } from "../../../lib/postgres-roster-invite-store";

function copyCookies(source: Response, target: NextResponse) {
  const headers = source.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? [source.headers.get("set-cookie")].filter((value): value is string => Boolean(value));
  for (const cookie of cookies) target.headers.append("set-cookie", cookie);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const email = typeof form.get("email") === "string" ? String(form.get("email")).trim().toLowerCase() : "";
  const password = typeof form.get("password") === "string" ? String(form.get("password")) : "";
  const requestedNext = typeof form.get("next") === "string" ? String(form.get("next")) : "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") && !/[\\\s]/.test(requestedNext) ? requestedNext : "/";
  // Next dev is bound to 0.0.0.0, but the browser's Origin is the actual
  // Wi-Fi address. Better Auth must validate that browser origin, not 0.0.0.0.
  const origin = request.headers.get("origin") || process.env.BETTER_AUTH_URL || new URL(request.url).origin;
  const token = rosterInviteTokenFromPath(next);
  const inviteNext = token ? `&${new URLSearchParams({ next })}` : "";
  const signInPage = (query: string) => NextResponse.redirect(new URL(`/sign-in?${query}${inviteNext}`, origin), { status: 303 });
  if (!/^\S+@\S+\.\S+$/.test(email) || !password) {
    return signInPage("error=invalid-request");
  }
  const callbackURL = inviteNext ? `/sign-in?${new URLSearchParams({ next })}` : undefined;
  const authResponse = await callEmailAuth(auth.handler, request, "/api/auth/sign-in/email", { email, password, rememberMe: true, callbackURL });
  if (!authResponse.ok) {
    const result = await authResponse.json().catch(() => null) as { code?: string } | null;
    if (result?.code === "EMAIL_NOT_VERIFIED") {
      return signInPage("verification=resent");
    }
    if (result?.code === stagingAccessError) return signInPage("error=staging-access");
    const error = authResponse.status === 429 ? "rate-limited" : authResponse.status === 503 ? "verification-delivery" : "invalid-credentials";
    return signInPage(`error=${error}`);
  }
  if (token && usesPostgres()) {
    try {
      const result = await authResponse.json() as { user?: { id: string } };
      if (result.user?.id) await decideRosterInvite(result.user.id, { token }, true, true);
    } catch (error) {
      // The invitation page still lets the recipient accept after signing in.
      console.error("Could not complete roster invitation during sign-in:", error instanceof Error ? error.name : "Unknown error");
    }
  }
  const response = NextResponse.redirect(new URL(next, origin), { status: 303 });
  copyCookies(authResponse, response);
  return response;
}
