import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { createVideoGroup, listVideoGroups } from "../../lib/video-library-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view groups." }, { status: 401 });
    return NextResponse.json(usesPostgres() ? await listVideoGroups(user.id) : [], { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load video groups:", error);
    return NextResponse.json({ error: "Your video groups could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to create a group." }, { status: 401 });
    if (!usesPostgres()) return NextResponse.json({ error: "Video groups are unavailable in this environment." }, { status: 503 });
    const body = await request.json().catch(() => null) as { name?: unknown } | null;
    if (typeof body?.name !== "string" || !body.name.trim() || body.name.trim().length > 100) return NextResponse.json({ error: "Enter a group name of 1–100 characters." }, { status: 400 });
    return NextResponse.json(await createVideoGroup(user.id, body.name), { status: 201 });
  } catch (error) {
    console.error("Could not create video group:", error);
    return NextResponse.json({ error: "The group could not be created." }, { status: 500 });
  }
}
