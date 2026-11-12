import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { createInvitation } from "../../lib/session-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to create an invitation." }, { status: 401 });
  const body = await request.json().catch(() => null) as { email?: unknown; role?: unknown; studentId?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = body?.role === "teacher" || body?.role === "student" ? body.role : null;
  const studentId = typeof body?.studentId === "string" ? body.studentId : null;
  if (!/^\S+@\S+\.\S+$/.test(email) || !role || (role === "student" && !studentId)) return NextResponse.json({ error: "Choose a role and enter a valid email. Student invitations also need a student profile." }, { status: 400 });
  const invitation = createInvitation({ userId: user.id, email, role, studentId });
  if (!invitation) return NextResponse.json({ error: "Only a company owner or admin can invite this person." }, { status: 403 });
  return NextResponse.json(invitation, { status: 201 });
}
