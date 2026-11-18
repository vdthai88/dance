import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { usesPostgres } from "../../../lib/database-driver";
import { deleteLibraryVideo, getLibraryVideoDetails, moveLibraryVideo } from "../../../lib/video-library-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ videoId: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view your video feedback." }, { status: 401 });
    if (!usesPostgres()) return new NextResponse(null, { status: 404 });
    const { videoId } = await context.params;
    const details = await getLibraryVideoDetails(user.id, videoId);
    return details ? NextResponse.json(details, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Video not found." }, { status: 404 });
  } catch (error) {
    console.error("Could not load video review:", error);
    return NextResponse.json({ error: "The saved video review could not be loaded." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ videoId: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to organize videos." }, { status: 401 });
    if (!usesPostgres()) return new NextResponse(null, { status: 404 });
    const body = await request.json().catch(() => null) as { groupId?: unknown } | null;
    if (!body || (body.groupId !== null && (typeof body.groupId !== "string" || !body.groupId))) return NextResponse.json({ error: "Choose a group or Ungrouped." }, { status: 400 });
    const { videoId } = await context.params;
    const moved = await moveLibraryVideo(user.id, videoId, body.groupId as string | null);
    return moved ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "The video or group was not found." }, { status: 404 });
  } catch (error) {
    console.error("Could not move library video:", error);
    return NextResponse.json({ error: "The video could not be moved. Try again." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ videoId: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to delete a video." }, { status: 401 });
    if (!usesPostgres()) return NextResponse.json({ error: "This video is unavailable." }, { status: 404 });
    const { videoId } = await context.params;
    const option = new URL(request.url).searchParams.get("deleteCritiques");
    if (option !== null && option !== "true" && option !== "false") return NextResponse.json({ error: "Choose video only or video and critiques." }, { status: 400 });
    const result = await deleteLibraryVideo(user.id, videoId, undefined, option === "true");
    if (result === "not-found") return NextResponse.json({ error: "This video was not found or has already been deleted." }, { status: 404 });
    if (result === "forbidden") return NextResponse.json({ error: "Only the person who uploaded this session video can delete it." }, { status: 403 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Could not delete ReplAI video:", error);
    return NextResponse.json({ error: "The video could not be deleted. Please try again." }, { status: 500 });
  }
}
