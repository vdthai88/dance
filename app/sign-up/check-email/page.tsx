import Link from "next/link";

export default function CheckEmailPage() {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="check-email-title">
        <p className="eyebrow">ONE</p>
        <h1 id="check-email-title">Check your email</h1>
        <p className="auth-copy">
          Check your inbox for a link to confirm your email address. The link expires in one hour.
          If you don’t see it, check your spam folder. Once you’ve confirmed your email, you can sign in.
        </p>
        <Link className="button button-dark" href="/sign-in">
          Click here to return to the login screen
        </Link>
      </section>
    </main>
  );
}
