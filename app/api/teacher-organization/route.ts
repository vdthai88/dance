import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { associateTeacherWithOrganization, getTeacherOrganization } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view the company profile." }, { status: 401 });
    return NextResponse.json({ organization: getTeacherOrganization(user.id) });
  }
  catch (error) {
    console.error("Could not load the teacher company profile:", error);
    return NextResponse.json({ error: "The teacher company profile could not be loaded." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null) as { name?: unknown; type?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const type = body?.type;
  if (!name || name.length > 160 || (type !== "studio" && type !== "private_company" && type !== "other")) {
    return NextResponse.json({ error: "Enter a company name up to 160 characters and choose a company type." }, { status: 400 });
  }
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to update the company profile." }, { status: 401 });
    return NextResponse.json({ organization: associateTeacherWithOrganization(user.id, { name, type }) });
  } catch (error) {
    console.error("Could not save the teacher company profile:", error);
    return NextResponse.json({ error: "The teacher could not be associated with this company." }, { status: 500 });
  }
}
