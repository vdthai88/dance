import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { getTeacherProfile, setTeacherCompanyOwner } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view the teacher profile." }, { status: 401 });
    return NextResponse.json(getTeacherProfile(user.id));
  }
  catch (error) {
    console.error("Could not load the teacher profile:", error);
    return NextResponse.json({ error: "The teacher profile could not be loaded." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null) as { isCompanyOwner?: unknown } | null;
  if (typeof body?.isCompanyOwner !== "boolean") {
    return NextResponse.json({ error: "Choose whether this teacher is a company owner." }, { status: 400 });
  }
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to update the teacher profile." }, { status: 401 });
    return NextResponse.json(setTeacherCompanyOwner(user.id, body.isCompanyOwner));
  }
  catch (error) {
    console.error("Could not save the teacher profile:", error);
    return NextResponse.json({ error: "The teacher profile could not be saved." }, { status: 500 });
  }
}
