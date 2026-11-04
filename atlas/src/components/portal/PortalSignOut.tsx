"use client";
export function PortalSignOut() {
  return <button className="rounded-lg px-3 py-2 text-sm text-forest-100 hover:bg-forest-800" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); }}>Sign out</button>;
}
