"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./Icon";

/** Only actions that have a working form are offered. */
const ITEMS = [{ href: "/customers/new", label: "New customer" }];

export function CreateMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className="btn-gold !px-3 sm:!px-4" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <Icon name="plus" /> <span className="hidden sm:inline">Create</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-stone-200 bg-white p-1 shadow-card">
          {ITEMS.map((i) => (
            <Link key={i.href} role="menuitem" href={i.href} onClick={() => setOpen(false)} className="flex min-h-[44px] items-center rounded-lg px-3 text-sm hover:bg-stone-50">{i.label}</Link>
          ))}
        </div>
      )}
    </div>
  );
}
