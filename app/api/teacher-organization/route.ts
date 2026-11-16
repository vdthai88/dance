import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { getPgTeacherOrganization } from "../../lib/postgres-profile-store";
import { getTeacherOrganization } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view the company profile." }, { status: 401 });
    return NextResponse.json({ organization: usesPostgres() ? await getPgTeacherOrganization(user.id) : getTeacherOrganization(user.id) });
  }
  catch (error) {
    console.error("Could not load the teacher company profile:", error);
    return NextResponse.json({ error: "The teacher company profile could not be loaded." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  await request.json().catch(() => null);
  return NextResponse.json({ error: "Use Create company or Request to join from Profile. Direct company association is disabled." }, { status: 410 });
}
