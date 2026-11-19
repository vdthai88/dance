import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../../lib/auth-session";
import { findLibraryVideo } from "../../../../lib/video-library-store";
import { selectPgDancer } from "../../../../lib/postgres-dancer-store";
import { isDancerTarget } from "../../../../lib/dancer-selection";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ videoId: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to select a dancer." }, { status: 401 });
  const { videoId } = await context.params;
  const found = await findLibraryVideo(user.id, videoId);
  if (!found) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  const target: unknown = await request.json().catch(() => null);
  if (!isDancerTarget(target)) return NextResponse.json({ error: "Describe the dancer and choose a valid reference time." }, { status: 400 });
  return NextResponse.json(await selectPgDancer(user.id, found.hash, target));
}
