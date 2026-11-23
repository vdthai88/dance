import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../lib/auth";
import { stagingAccessEnabled, stagingAccessError, stagingAccessMessage, stagingUserAllowed } from "../../../lib/staging-access";

const handlers = toNextJsHandler(auth);
const publicAuthPaths = new Set([
  "sign-in/email", "sign-in/social", "sign-up/email", "sign-out",
  "verify-email", "send-verification-email", "request-password-reset", "reset-password",
]);

async function handle(request: Request, handler: (request: Request) => Promise<Response>) {
  let oauthCallback = false;
  if (stagingAccessEnabled()) {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, "").replace(/\/$/, "");
    oauthCallback = path.startsWith("callback/");
    if (!publicAuthPaths.has(path) && !oauthCallback && !path.startsWith("reset-password/")) {
      const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
      if (session && !stagingUserAllowed(session.user)) {
        const headers = { "Cache-Control": "no-store" };
        return path === "get-session" ? Response.json(null, { headers })
          : Response.json({ code: stagingAccessError, message: stagingAccessMessage }, { status: 403, headers });
      }
    }
  }
  const response = await handler(request);
  if (oauthCallback && response.status === 403) {
    const result = await response.clone().json().catch(() => null) as { code?: string } | null;
    if (result?.code === stagingAccessError) {
      return Response.redirect(new URL("/sign-in?error=staging-access", process.env.BETTER_AUTH_URL || request.url), 303);
    }
  }
  return response;
}

export const GET = (request: Request) => handle(request, handlers.GET);
export const POST = (request: Request) => handle(request, handlers.POST);
