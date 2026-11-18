export type ProfileNames = { firstName?: string | null; lastName?: string | null };

export function hasSavedProfileNames(profile: ProfileNames) {
  return Boolean(profile.firstName?.trim() && profile.lastName?.trim());
}

export function accountLanding(profile: ProfileNames, roles: string[]) {
  if (!hasSavedProfileNames(profile)) return "/?page=profile&required=1";
  return roles.includes("teacher") || roles.includes("admin") ? "/?page=coaching" : "/?page=replai";
}

/** Preserve explicit navigation; setup flags never override a completed saved profile. */
export function accountEntryRedirect(profile: ProfileNames, roles: string[], search: URLSearchParams): string | null {
  const page = search.get("page");
  if (!hasSavedProfileNames(profile)) {
    return page === "profile" && search.get("required") === "1" ? null : accountLanding(profile, roles);
  }
  if (search.has("required")) {
    const clean = new URLSearchParams(search);
    clean.delete("required");
    if (page === "profile" || !["profile", "replai", "coaching"].includes(page ?? "")) return accountLanding(profile, roles);
    return "/?" + clean.toString();
  }
  return ["profile", "replai", "coaching"].includes(page ?? "") ? null : accountLanding(profile, roles);
}
