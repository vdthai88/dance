type EmailAuthPath = "/api/auth/sign-in/email" | "/api/auth/sign-up/email";

/** Invoke auth in-process: Render's public HTTPS origin terminates at its proxy,
 * while the Next.js listener uses HTTP. A self-fetch can mix those protocols. */
export function callEmailAuth(
  handler: (request: Request) => Promise<Response>,
  originalRequest: Request,
  path: EmailAuthPath,
  body: Record<string, unknown>,
) {
  const origin = originalRequest.headers.get("origin") || process.env.BETTER_AUTH_URL || new URL(originalRequest.url).origin;
  return handler(new Request(new URL(path, process.env.BETTER_AUTH_URL || originalRequest.url), {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
