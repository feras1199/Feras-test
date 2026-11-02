import { route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { can } from "@/lib/auth/roles";
import { normPhone } from "@/lib/domain/customers";

export const GET = route("dashboard.view", async ({ req, session }) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  if (q.length < 2) return { hits: [] };
  const digits = normPhone(q);
  const repo = getRepo();
  const match = (...vals: (string | null | undefined)[]) => vals.some((v) => v && v.toLowerCase().includes(q));
  const hits: { type: string; id: string; title: string; subtitle?: string; href: string }[] = [];

  if (can(session.role, "crm.view")) {
    for (const c of await repo.list("customers")) {
      if (match(c.name, c.email, c.suburb, c.address) || (digits.length >= 4 && normPhone(c.phone).includes(digits)))
        hits.push({ type: "Customer", id: c.id, title: c.name ?? "(no name)", subtitle: [c.suburb, c.phone].filter(Boolean).join(" · "), href: `/customers/${c.id}` });
    }
    for (const e of await repo.list("enquiries")) {
      if (match(e.title, e.serviceRequested)) hits.push({ type: "Enquiry", id: e.id, title: e.title ?? "Enquiry", subtitle: e.status ?? undefined, href: `/customers/${e.customerIds?.[0] ?? ""}` });
    }
  }
  if (can(session.role, "estimates.view")) {
    for (const e of await repo.list("estimates")) {
      if (match(e.title, e.quoteNumber)) hits.push({ type: "Quote", id: e.id, title: e.title ?? "Estimate", subtitle: e.status ?? undefined, href: `/customers/${e.customerIds?.[0] ?? ""}` });
    }
  }
  for (const p of await repo.list("projects")) {
    if (match(p.name, p.suburb, p.siteAddress)) hits.push({ type: "Project", id: p.id, title: p.name ?? "Project", subtitle: p.status ?? undefined, href: can(session.role, "crm.view") && p.customerIds?.[0] ? `/customers/${p.customerIds[0]}` : "/" });
  }
  return { hits: hits.slice(0, 20) };
});
