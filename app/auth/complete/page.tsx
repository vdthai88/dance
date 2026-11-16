import { SocialAuthCompleter } from "../../components/social-auth-completer";

export default async function SocialAuthCompletePage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const params = await searchParams;
  const role = params.role === "student" || params.role === "teacher" ? params.role : null;
  return <SocialAuthCompleter role={role} />;
}
