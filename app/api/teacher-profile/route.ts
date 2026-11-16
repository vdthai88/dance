import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { getPgTeacherProfile } from "../../lib/postgres-profile-store";
import { getTeacherProfile } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view the teacher profile." }, { status: 401 });
    return NextResponse.json(usesPostgres() ? await getPgTeacherProfile(user.id) : getTeacherProfile(user.id));
  }
  catch (error) {
    console.error("Could not load the teacher profile:", error);
    return NextResponse.json({ error: "The teacher profile could not be loaded." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  await request.json().catch(() => null);
  return NextResponse.json({ error: "Company ownership can only be assigned through the company administration workflow." }, { status: 410 });
}
