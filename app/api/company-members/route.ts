import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { listCompanyMembers } from "../../lib/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view company members." }, { status: 401 });
    return NextResponse.json(listCompanyMembers(user.id));
  } catch (error) {
    console.error("Could not list company members:", error);
    return NextResponse.json({ error: "The company member list could not be loaded." }, { status: 500 });
  }
}
