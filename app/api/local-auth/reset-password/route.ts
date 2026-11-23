import { NextResponse } from "next/server";
import { auth } from "../../../lib/auth";
import { callEmailAuth } from "../../../lib/email-auth-request";
import { passwordEntryError } from "../../../lib/password-policy";

export async function POST(request: Request) {
  const origin = process.env.BETTER_AUTH_URL || request.url;
  const redirect = (path: string) => NextResponse.redirect(new URL(path, origin), { status: 303 });
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(token)) return redirect("/reset-password?error=invalid-token");

  const retry = (error: string) => redirect(`/reset-password?${new URLSearchParams({ token, error })}`);
  const password = form.get("password");
  const error = passwordEntryError(password, form.get("confirmPassword"));
  if (error) return retry(error);

  const response = await callEmailAuth(auth.handler, request, "/api/auth/reset-password", { token, newPassword: password });
  if (response.ok) return redirect("/sign-in?password=reset");
  const payload = await response.json().catch(() => null) as { code?: string } | null;
  if (payload?.code === "INVALID_TOKEN") return redirect("/reset-password?error=invalid-token");
  return retry(response.status === 429 ? "rate-limited" : "unavailable");
}
