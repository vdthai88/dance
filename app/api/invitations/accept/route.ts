import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { acceptInvitation } from "../../../lib/session-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in with the invited email address to accept this invitation." }, { status: 401 });
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  if (typeof body?.token !== "string" || !body.token) return NextResponse.json({ error: "This invitation link is incomplete." }, { status: 400 });
  const result = acceptInvitation(user, body.token);
  if (result === "email_mismatch") return NextResponse.json({ error: "Sign in with the email address that received this invitation." }, { status: 403 });
  if (result === "invalid") return NextResponse.json({ error: "This invitation is invalid, expired, or already used." }, { status: 404 });
  return NextResponse.json(result);
}
