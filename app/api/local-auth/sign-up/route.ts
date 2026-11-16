import { NextResponse } from "next/server";
import { usesPostgres } from "../../../lib/database-driver";
import { choosePgAccountRole } from "../../../lib/postgres-profile-store";
import { chooseAccountRole } from "../../../lib/session-store";

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
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320 || password.length < 8) {
    return NextResponse.redirect(new URL("/sign-up?error=invalid-request", origin), { status: 303 });
  }
  const authResponse = await fetch(new URL("/api/auth/sign-up/email", request.url), {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  const payload = await authResponse.json().catch(() => null) as { user?: { id?: string } } | null;
  if (!authResponse.ok || !payload?.user?.id) {
    const error = authResponse.status === 429 ? "rate-limited" : "account-not-created";
    return NextResponse.redirect(new URL(`/sign-up?error=${error}`, origin), { status: 303 });
  }
  if (usesPostgres()) await choosePgAccountRole(payload.user.id, role);
  else chooseAccountRole(payload.user.id, role);
  const response = NextResponse.redirect(new URL("/?page=profile&required=1", origin), { status: 303 });
  copyCookies(authResponse, response);
  return response;
}
