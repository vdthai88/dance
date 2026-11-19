export const emailVerificationEnabled = Boolean(
  process.env.RESEND_API_KEY?.trim() || process.env.AUTH_EMAIL_FROM?.trim() ||
  (process.env.NODE_ENV === "development" && process.env.AUTH_EMAIL_DEV_LOG === "true"),
);

const verificationCallback = "/sign-in?verification=confirmed";

async function sendVerificationMessage(to: string, url: string) {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AUTH_EMAIL_FROM?.trim();
  if (!key && !from && process.env.NODE_ENV === "development" && process.env.AUTH_EMAIL_DEV_LOG === "true") {
    console.info("Local email verification link:", url);
    return;
  }
  if (!key || !from) throw new Error("Auth email sender configuration is incomplete.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Verify your One Dance email address",
      text: `Open this link within 1 hour to verify your email address for One Dance:\n\n${url}\n\nIf you did not request this email, you can ignore it.`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Auth email delivery returned HTTP ${response.status}.`);
}
import { APIError } from "better-auth/api";


export const emailVerificationOptions = {
  sendOnSignUp: true,
  sendOnSignIn: true,
  expiresIn: 60 * 60,
  async sendVerificationEmail({ user, url }: { user: { email: string }; url: string }) {
    const link = new URL(url);
    link.searchParams.set("callbackURL", verificationCallback);
    try {
      await sendVerificationMessage(user.email, link.toString());
    } catch (error) {
      console.error("Verification email failed:", error instanceof Error ? error.message : "Unknown delivery error");
      throw new APIError("SERVICE_UNAVAILABLE", {
        code: "VERIFICATION_DELIVERY_FAILED",
        message: "Verification email could not be sent.",
      });
    }
  },
};
