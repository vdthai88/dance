import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { chooseAccountRole } from "../../../lib/session-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to choose an account role." }, { status: 401 });
  const body = await request.json().catch(() => null) as { role?: unknown } | null;
  if (body?.role !== "student" && body?.role !== "teacher") {
    return NextResponse.json({ error: "Choose Student or Teacher." }, { status: 400 });
  }
  chooseAccountRole(user.id, body.role);
  return NextResponse.json({ role: body.role });
}
