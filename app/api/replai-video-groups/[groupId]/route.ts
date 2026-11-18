import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { usesPostgres } from "../../../lib/database-driver";
import { updateVideoGroup } from "../../../lib/video-library-store";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ groupId: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to update a group." }, { status: 401 });
    if (!usesPostgres()) return new NextResponse(null, { status: 404 });
    const body = await request.json().catch(() => null) as { name?: unknown; collapsed?: unknown } | null;
    if (!body || (body.name === undefined && body.collapsed === undefined)
      || (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100))
      || (body.collapsed !== undefined && typeof body.collapsed !== "boolean")) return NextResponse.json({ error: "Enter a valid group name or collapse setting." }, { status: 400 });
    const { groupId } = await context.params;
    const group = await updateVideoGroup(user.id, groupId, body as { name?: string; collapsed?: boolean });
    return group ? NextResponse.json(group) : NextResponse.json({ error: "Group not found." }, { status: 404 });
  } catch (error) {
    console.error("Could not update video group:", error);
    return NextResponse.json({ error: "The group could not be updated." }, { status: 500 });
  }
}
