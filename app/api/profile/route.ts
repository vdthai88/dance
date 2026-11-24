import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../lib/auth-session";
import { usesPostgres } from "../../lib/database-driver";
import { getPgAccountRoles, getPgGoogleNameSuggestion, getPgUserProfile, listPgUserCompanies, savePgUserProfile } from "../../lib/postgres-profile-store";
import { getAccountRoles, getUserProfile, listUserCompanies, saveUserProfile } from "../../lib/session-store";
import { getPgProTrial } from "../../lib/postgres-pro-trial-store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to view your profile." }, { status: 401 });
    if (usesPostgres()) {
      const [profile, roles, companies, googleSuggestion, proTrial] = await Promise.all([
        getPgUserProfile(user.id), getPgAccountRoles(user.id), listPgUserCompanies(user.id), getPgGoogleNameSuggestion(user.id, user.name), getPgProTrial(user.id),
      ]);
      const suggestedProfile = googleSuggestion ? {
        ...profile,
        firstName: profile.firstName || googleSuggestion.firstName,
        lastName: profile.lastName || googleSuggestion.lastName,
      } : profile;
      return NextResponse.json({ ...suggestedProfile, email: user.email, roles, companies, proTrial }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ...getUserProfile(user.id), email: user.email, roles: getAccountRoles(user.id), companies: listUserCompanies(user.id) });
  } catch (error) {
    console.error("Could not load profile:", error);
    return NextResponse.json({ error: "Your profile could not be loaded. Please try again." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to update your profile." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
    const organizationName = typeof body?.organizationName === "string" ? body.organizationName.trim() : "";
    const birthYear = typeof body?.birthYear === "number" && Number.isInteger(body.birthYear) ? body.birthYear : null;
    const currentYear = new Date().getFullYear();
    if (!firstName || !lastName) return NextResponse.json({ error: "First Name and Last Name are required." }, { status: 400 });
    if (birthYear !== null && (birthYear < 1900 || birthYear > currentYear)) return NextResponse.json({ error: "Enter a valid birth year." }, { status: 400 });
    if (firstName.length > 100 || lastName.length > 100 || organizationName.length > 160) return NextResponse.json({ error: "Keep names under 100 characters and organization under 160." }, { status: 400 });
    const profile = { firstName, lastName, organizationName, birthYear };
    return NextResponse.json(usesPostgres() ? await savePgUserProfile(user.id, profile) : saveUserProfile(user.id, profile));
  } catch (error) {
    console.error("Could not save profile:", error);
    return NextResponse.json({ error: "Your profile could not be saved. Please try again." }, { status: 500 });
  }
}
