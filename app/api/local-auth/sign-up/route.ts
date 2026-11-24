import { NextResponse } from "next/server";
import { auth } from "../../../lib/auth";
import { callEmailAuth, isValidEmailAddress } from "../../../lib/email-auth-request";
import { emailVerificationEnabled } from "../../../lib/auth-email";
import { usesPostgres } from "../../../lib/database-driver";
import { choosePgAccountRole } from "../../../lib/postgres-profile-store";
import { chooseAccountRole } from "../../../lib/session-store";
import { passwordEntryError } from "../../../lib/password-policy";
import { stagingAccessError } from "../../../lib/staging-access";
import { findRosterInvite } from "../../../lib/postgres-roster-invite-store";
import { isRosterInviteToken, rosterInvitePath } from "../../../lib/roster-invite-links";

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
  const token = form.get("rosterInvite");
  const invitePath = rosterInvitePath(token);
  const inviteParam: Record<string, string> = invitePath ? { invite: String(token) } : {};
  const role = !invitePath && form.get("role") === "teacher" ? "teacher" : "student";
  // Next dev is bound to 0.0.0.0, but the browser's Origin is the actual
  // Wi-Fi address. Better Auth must validate that browser origin, not 0.0.0.0.
  const origin = request.headers.get("origin") || process.env.BETTER_AUTH_URL || new URL(request.url).origin;
  const retry = (error: string) => NextResponse.redirect(new URL(`/sign-up?${new URLSearchParams({ error, ...inviteParam })}`, origin), { status: 303 });
  if (isRosterInviteToken(token)) {
    const invitation = usesPostgres() ? await findRosterInvite(token) : null;
    if (!invitation || invitation.status !== "pending" || invitation.recipientId || invitation.email !== email || !emailVerificationEnabled) {
      return NextResponse.redirect(new URL(invitePath!, origin), { status: 303 });
    }
  }
  if (!isValidEmailAddress(email)) {
    return retry("invalid-request");
  }
  const passwordError = passwordEntryError(password, form.get("confirmPassword"));
  if (passwordError) return retry(passwordError);
  const callbackURL = invitePath ? `/sign-in?${new URLSearchParams({ next: invitePath })}` : undefined;
  const authResponse = await callEmailAuth(auth.handler, request, "/api/auth/sign-up/email", { name, email, password, callbackURL });
  const payload = await authResponse.json().catch(() => null) as { user?: { id?: string }; code?: string } | null;
  if (!authResponse.ok || !payload?.user?.id) {
    if (payload?.code === stagingAccessError) return retry("staging-access");
    const error = authResponse.status === 429 ? "rate-limited" : authResponse.status === 503 ? "verification-delivery" : "account-not-created";
    return retry(error);
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
    const checkEmailPath = invitePath ? `/sign-up/check-email?${new URLSearchParams({ next: invitePath })}` : "/sign-up/check-email";
    return NextResponse.redirect(new URL(checkEmailPath, origin), { status: 303 });
  }
  if (usesPostgres()) await choosePgAccountRole(payload.user.id, role);
  else chooseAccountRole(payload.user.id, role);
  const response = NextResponse.redirect(new URL("/?page=profile&required=1", origin), { status: 303 });
  copyCookies(authResponse, response);
  return response;
}
