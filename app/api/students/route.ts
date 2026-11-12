import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { createStudent, getTeacherOrganization, listStudentsForTeacher, listStudentsForUser } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view student profiles." }, { status: 401 });
    return NextResponse.json(url.searchParams.get("scope") === "teacher" ? listStudentsForTeacher(user.id) : listStudentsForUser(user.id));
  }
  catch (error) {
    console.error("Could not list student profiles:", error);
    return NextResponse.json({ error: "The student profile database could not be read." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { name?: unknown; organizationId?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return NextResponse.json({ error: "Enter a student name up to 100 characters." }, { status: 400 });
  const organizationId = typeof body?.organizationId === "string" && body.organizationId ? body.organizationId : null;
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to create a student profile." }, { status: 401 });
    if (organizationId && organizationId !== getTeacherOrganization(user.id)?.id) {
      return NextResponse.json({ error: "Choose the company associated with this Teacher profile, or leave the student unassigned." }, { status: 400 });
    }
    return NextResponse.json(createStudent({ name, teacherUserId: user.id, organizationId }), { status: 201 });
  }
  catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return NextResponse.json({ error: "A student with that name already exists." }, { status: 409 });
    }
    if (error instanceof Error && error.message.includes("FOREIGN KEY constraint failed")) {
      return NextResponse.json({ error: "The selected company could not be found." }, { status: 404 });
    }
    console.error("Could not create student profile:", error);
    return NextResponse.json({ error: "The student profile could not be saved." }, { status: 500 });
  }
}
