import { auth } from "./auth";
import { stagingAccessEnabled, stagingUserAllowed } from "./staging-access";

export async function getAuthenticatedUser(request: Pick<Request, "headers">) {
  const session = await auth.api.getSession({
    headers: request.headers,
    query: stagingAccessEnabled() ? { disableCookieCache: true } : undefined,
  });
  return session && stagingUserAllowed(session.user) ? session.user : null;
}
