import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";
import { demoLoginsEnabled, DEMO_PASSWORD } from "@/lib/auth/users";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const demo = demoLoginsEnabled();
  return (
    <main className="flex min-h-screen items-center justify-center bg-forest-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="h-14 w-14" />
          <h1 className="mt-4 font-display text-3xl font-semibold text-stone-50">ATLAS</h1>
          <p className="mt-1 text-sm text-forest-200">Whispering Leaf Landscaping &amp; Construction</p>
        </div>
        <div className="card p-6">
          <LoginForm next={next && next.startsWith("/") && !next.startsWith("//") ? next : undefined} />
        </div>
        {demo && (
          <div className="mt-4 rounded-xl border border-gold-500/40 bg-forest-800 p-4 text-sm text-forest-100">
            <p className="font-semibold text-gold-300">Demo mode, fictional data</p>
            <p className="mt-1">
              Sign in as owner@, manager@, sales@, supervisor@, worker@example.com or taylor.demo@example.com (customer). Password: <code className="text-gold-300">{DEMO_PASSWORD}</code>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
