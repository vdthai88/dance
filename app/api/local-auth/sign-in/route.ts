import { NextResponse } from "next/server";

function copyCookies(source: Response, target: NextResponse) {
  const headers = source.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? [source.headers.get("set-cookie")].filter((value): value is string => Boolean(value));
  for (const cookie of cookies) target.headers.append("set-cookie", cookie);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const email = typeof form.get("email") === "string" ? String(form.get("email")) : "";
  const password = typeof form.get("password") === "string" ? String(form.get("password")) : "";
  // Next dev is bound to 0.0.0.0, but the browser's Origin is the actual
  // Wi-Fi address. Better Auth must validate that browser origin, not 0.0.0.0.
  const origin = request.headers.get("origin") || process.env.BETTER_AUTH_URL || new URL(request.url).origin;
  const authResponse = await fetch(new URL("/api/auth/sign-in/email", request.url), {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
  if (!authResponse.ok) return NextResponse.redirect(new URL("/sign-in?error=invalid-credentials", origin), { status: 303 });
  const response = NextResponse.redirect(new URL("/", origin), { status: 303 });
  copyCookies(authResponse, response);
  return response;
}
