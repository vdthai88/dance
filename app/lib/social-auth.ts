export const socialProviderIds = ["google", "apple", "facebook"] as const;

export type SocialProviderId = (typeof socialProviderIds)[number];

export type SocialProvider = {
  id: SocialProviderId;
  label: string;
};

const providerLabels: Record<SocialProviderId, string> = {
  google: "Google",
  apple: "Apple",
  facebook: "Facebook",
};

function hasCredentials(id: SocialProviderId) {
  const prefix = id === "facebook" ? "FACEBOOK" : id.toUpperCase();
  return Boolean(process.env[`${prefix}_CLIENT_ID`] && process.env[`${prefix}_CLIENT_SECRET`]);
}

/** Safe to pass to a client component: it contains no provider credentials. */
export function enabledSocialProviders(): SocialProvider[] {
  return socialProviderIds.filter(hasCredentials).map((id) => ({ id, label: providerLabels[id] }));
}

export function configuredSocialProviders() {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};
  for (const id of socialProviderIds) {
    if (!hasCredentials(id)) continue;
    const prefix = id === "facebook" ? "FACEBOOK" : id.toUpperCase();
    providers[id] = {
      clientId: process.env[`${prefix}_CLIENT_ID`]!,
      clientSecret: process.env[`${prefix}_CLIENT_SECRET`]!,
    };
  }
  return providers;
}
