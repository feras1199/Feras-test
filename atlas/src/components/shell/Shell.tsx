"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "../Logo";
import { Icon } from "./Icon";
import { GlobalSearch } from "./GlobalSearch";
import { CreateMenu } from "./CreateMenu";
import type { NavItem } from "./nav";

export function Shell({ nav, user, demo, canCreate, children }: { nav: NavItem[]; user: { name: string; roleLabel: string }; demo: boolean; canCreate: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  const links = (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {nav.map((n) => (
        <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active(n.href) ? "page" : undefined}
          className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${active(n.href) ? "bg-forest-700 text-white" : "text-forest-100 hover:bg-forest-800"}`}>
          <Icon name={n.icon} />
          {n.label}
        </Link>
      ))}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-forest-900 px-3 py-4">
      <Link href="/" className="mb-6 flex items-center gap-3 px-2">
        <Logo />
        <div>
          <div className="font-display text-lg font-semibold leading-none text-stone-50">ATLAS</div>
          <div className="text-[11px] text-forest-300">Whispering Leaf</div>
        </div>
      </Link>
      {links}
      <div className="mt-auto border-t border-forest-800 pt-3">
        <div className="px-3 text-sm text-stone-100">{user.name}</div>
        <div className="px-3 text-xs text-forest-300">{user.roleLabel}</div>
        <button onClick={logout} className="mt-2 flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-sm text-forest-100 hover:bg-forest-800">
          <Icon name="logout" /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64 print:!pl-0">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block print:!hidden">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%]">{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-20 print:hidden border-b border-stone-200 bg-paper/90 backdrop-blur">
        <div className="flex items-center gap-2 px-4 py-2 sm:px-6">
          <button className="btn-secondary !px-3 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="min-w-0 flex-1">
            <GlobalSearch />
          </div>
          {canCreate && <CreateMenu />}
        </div>
        {demo && <div className="bg-gold-300/60 px-4 py-1 text-center text-xs font-medium text-forest-900">Demo mode: fictional data only. Nothing here is a real customer.</div>}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
