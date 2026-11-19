import { NextResponse } from "next/server";
import { auth } from "../../../lib/auth";
import { callEmailAuth } from "../../../lib/email-auth-request";

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
  if (!/^\S+@\S+\.\S+$/.test(email) || !password) {
    return NextResponse.redirect(new URL("/sign-in?error=invalid-request", origin), { status: 303 });
  }
  const authResponse = await callEmailAuth(auth.handler, request, "/api/auth/sign-in/email", { email, password, rememberMe: true });
  if (!authResponse.ok) {
    const result = await authResponse.json().catch(() => null) as { code?: string } | null;
    if (result?.code === "EMAIL_NOT_VERIFIED") {
      return NextResponse.redirect(new URL("/sign-in?verification=resent", origin), { status: 303 });
    }
    const error = authResponse.status === 429 ? "rate-limited" : authResponse.status === 503 ? "verification-delivery" : "invalid-credentials";
    return NextResponse.redirect(new URL(`/sign-in?error=${error}`, origin), { status: 303 });
  }
  const response = NextResponse.redirect(new URL(next, origin), { status: 303 });
  copyCookies(authResponse, response);
  return response;
}
