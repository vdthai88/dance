import Link from "next/link";
import { rosterInviteTokenFromPath } from "../../lib/roster-invite-links";

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const signIn = rosterInviteTokenFromPath(next) ? `/sign-in?${new URLSearchParams({ next: next! })}` : "/sign-in";
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="check-email-title">
        <p className="eyebrow">ONE</p>
        <h1 id="check-email-title">Check your email</h1>
        <p className="auth-copy">
          Check your inbox for a link to confirm your email address. The link expires in one hour.
          If you don’t see it, check your spam folder. Once you’ve confirmed your email, you can sign in.
        </p>
        <Link className="button button-dark" href={signIn}>
          Click here to return to the login screen
        </Link>
      </section>
    </main>
  );
}
