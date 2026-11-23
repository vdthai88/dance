import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";

export const stagingAccessError = "STAGING_ACCESS_DENIED";
export const stagingAccessMessage = "Staging is invite-only. Sign in with an approved email address.";

export function stagingAccessEnabled() {
  return process.env.STAGING_ALLOWED_EMAILS !== undefined;
}

export function stagingEmailAllowed(email: unknown) {
  const configured = process.env.STAGING_ALLOWED_EMAILS;
  if (configured === undefined) return true;
  if (typeof email !== "string" || !email.trim()) return false;
  const normalized = email.trim().toLowerCase();
  return configured.split(",").some((entry) => entry.trim().toLowerCase() === normalized);
}

export function stagingUserAllowed(user: { email: string; emailVerified: boolean }) {
  return !stagingAccessEnabled() || (user.emailVerified && stagingEmailAllowed(user.email));
}

export function denyStagingAccess(): never {
  throw new APIError("FORBIDDEN", { code: stagingAccessError, message: stagingAccessMessage });
}

export function checkStagingEmailRequest(path: string, email: unknown) {
  if (["/sign-up/email", "/sign-in/email", "/request-password-reset", "/send-verification-email"].includes(path) &&
      !stagingEmailAllowed(email)) denyStagingAccess();
}

export const stagingDatabaseHooks = {
  user: {
    create: {
      async before(user, context) {
        if (!stagingEmailAllowed(user.email)) denyStagingAccess();
        if (stagingAccessEnabled() && context?.path !== "/sign-up/email" && !user.emailVerified) {
          denyStagingAccess();
        }
      },
    },
    update: {
      async before(user) {
        if (user.email !== undefined && !stagingEmailAllowed(user.email)) denyStagingAccess();
      },
    },
  },
  session: {
    create: {
      async before(session, context) {
        if (!stagingAccessEnabled()) return;
        const user = await context?.context.internalAdapter.findUserById(session.userId);
        if (!user || !stagingUserAllowed(user)) denyStagingAccess();
      },
    },
  },
} satisfies NonNullable<BetterAuthOptions["databaseHooks"]>;
