import { NextResponse } from "next/server";
import { usesPostgres } from "../../lib/database-driver";
import { findCritiqueForVideo, fingerprintVideo } from "../../lib/critique-store";
import { findPgCritiqueForVideo } from "../../lib/postgres-critique-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Choose a video to look up its saved critique." }, { status: 400 });
  }
  const video = form.get("video");
  if (!(video instanceof File)) {
    return NextResponse.json({ error: "Choose a video to look up its saved critique." }, { status: 400 });
  }
  try {
    const hash = await fingerprintVideo(video);
    const saved = usesPostgres() ? await findPgCritiqueForVideo(hash) : findCritiqueForVideo(hash);
    return NextResponse.json(saved);
  } catch (error) {
    console.error("Could not look up the saved critique:", error);
    return NextResponse.json({ error: "The local critique database could not be read." }, { status: 500 });
  }
}
