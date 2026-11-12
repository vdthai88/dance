import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { decideConnectionRequest } from "../../../lib/session-store";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ requestId: string }> }) { const user = await getAuthenticatedUser(request); if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 }); const body = await request.json().catch(() => null) as { accept?: unknown } | null; if (typeof body?.accept !== "boolean") return NextResponse.json({ error: "Choose accept or decline." }, { status: 400 }); const { requestId } = await context.params; return decideConnectionRequest(user.id, requestId, body.accept) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "This request is no longer available." }, { status: 404 }); }
