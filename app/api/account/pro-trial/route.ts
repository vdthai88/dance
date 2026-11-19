import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../../lib/auth-session";
import { usesPostgres } from "../../../lib/database-driver";
import { startPgProTrial } from "../../../lib/postgres-pro-trial-store";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to start your Pro trial." }, { status: 401 });
    if (!usesPostgres()) return NextResponse.json({ error: "Pro trials require PostgreSQL." }, { status: 503 });
    // Trial length is server-controlled; clients cannot choose or reset dates.
    const configuredDays = process.env.PRO_TRIAL_DAYS?.trim();
    const result = await startPgProTrial(user.id, configuredDays ? Number(configuredDays) : null);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not start Pro trial:", error);
    return NextResponse.json({ error: "Your Pro trial could not be started. Please try again." }, { status: 500 });
  }
}
