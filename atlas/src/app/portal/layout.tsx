import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { PortalSignOut } from "@/components/portal/PortalSignOut";
import { currentSession, getSettings } from "@/lib/server/context";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.role !== "customer" || !s.customerId) redirect("/");
  const b = getSettings().business;
  return (
    <div className="min-h-screen">
      <header className="bg-forest-900 text-stone-50">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <Link href="/portal" className="flex items-center gap-3"><Logo className="h-9 w-9" /><span className="font-display text-lg font-semibold">{b.name.split(" ").slice(0, 2).join(" ")}</span></Link>
          <PortalSignOut />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 text-xs text-stone-500">{[b.name, b.phone, b.email].filter(Boolean).join(" · ")}</footer>
    </div>
  );
}
