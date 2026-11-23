import { NextResponse } from "next/server";
import { auth } from "../../../lib/auth";
import { emailVerificationEnabled } from "../../../lib/auth-email";
import { callEmailAuth, isValidEmailAddress } from "../../../lib/email-auth-request";
import { stagingEmailAllowed } from "../../../lib/staging-access";

export async function POST(request: Request) {
  const origin = process.env.BETTER_AUTH_URL || request.url;
  const redirect = (query: string) => NextResponse.redirect(new URL(`/forgot-password?${query}`, origin), { status: 303 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!isValidEmailAddress(email)) return redirect("error=invalid-email");
  if (!emailVerificationEnabled) return redirect("error=unavailable");
  if (!stagingEmailAllowed(email)) return redirect("sent=1");

  const response = await callEmailAuth(auth.handler, request, "/api/auth/request-password-reset", {
    email,
    redirectTo: "/reset-password",
  });
  if (!response.ok) return redirect(response.status === 429 ? "error=rate-limited" : "error=unavailable");
  return redirect("sent=1");
}
