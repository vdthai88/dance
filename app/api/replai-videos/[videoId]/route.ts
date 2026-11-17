import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { usesPostgres } from "../../../lib/database-driver";
import { deleteLibraryVideo } from "../../../lib/video-library-store";

export const runtime = "nodejs";

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
