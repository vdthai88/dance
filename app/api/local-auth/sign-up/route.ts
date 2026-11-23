import { NextResponse } from "next/server";
import { auth } from "../../../lib/auth";
import { callEmailAuth, isValidEmailAddress } from "../../../lib/email-auth-request";
import { emailVerificationEnabled } from "../../../lib/auth-email";
import { usesPostgres } from "../../../lib/database-driver";
import { choosePgAccountRole } from "../../../lib/postgres-profile-store";
import { chooseAccountRole } from "../../../lib/session-store";
import { passwordEntryError } from "../../../lib/password-policy";

function copyCookies(source: Response, target: NextResponse) {
  const headers = source.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? [source.headers.get("set-cookie")].filter((value): value is string => Boolean(value));
  for (const cookie of cookies) target.headers.append("set-cookie", cookie);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const email = typeof form.get("email") === "string" ? String(form.get("email")).trim().toLowerCase() : "";
  const password = typeof form.get("password") === "string" ? String(form.get("password")) : "";
  const name = email.trim().split("@")[0] || "One member";
  const role = form.get("role") === "teacher" ? "teacher" : "student";
  // Next dev is bound to 0.0.0.0, but the browser's Origin is the actual
  // Wi-Fi address. Better Auth must validate that browser origin, not 0.0.0.0.
  const origin = request.headers.get("origin") || process.env.BETTER_AUTH_URL || new URL(request.url).origin;
  if (!isValidEmailAddress(email)) {
    return NextResponse.redirect(new URL("/sign-up?error=invalid-request", origin), { status: 303 });
  }
  const passwordError = passwordEntryError(password, form.get("confirmPassword"));
  if (passwordError) return NextResponse.redirect(new URL(`/sign-up?error=${passwordError}`, origin), { status: 303 });
  const authResponse = await callEmailAuth(auth.handler, request, "/api/auth/sign-up/email", { name, email, password });
  const payload = await authResponse.json().catch(() => null) as { user?: { id?: string } } | null;
  if (!authResponse.ok || !payload?.user?.id) {
    const error = authResponse.status === 429 ? "rate-limited" : authResponse.status === 503 ? "verification-delivery" : "account-not-created";
    return NextResponse.redirect(new URL(`/sign-up?error=${error}`, origin), { status: 303 });
  }
  if (emailVerificationEnabled) {
    // Better Auth returns a synthetic ID for duplicate sign-ups. Only assign a
    // role for an actual newly created user, never for the existing address.
    const { internalAdapter } = await auth.$context;
    const created = await internalAdapter.findUserById(payload.user.id);
    if (created) {
      if (usesPostgres()) await choosePgAccountRole(created.id, role);
      else chooseAccountRole(created.id, role);
    }
    return NextResponse.redirect(new URL("/sign-up/check-email", origin), { status: 303 });
  }
  if (usesPostgres()) await choosePgAccountRole(payload.user.id, role);
  else chooseAccountRole(payload.user.id, role);
  const response = NextResponse.redirect(new URL("/?page=profile&required=1", origin), { status: 303 });
  copyCookies(authResponse, response);
  return response;
}
