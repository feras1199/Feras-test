import type { Repository } from "../data/repository";
import { can, type Role } from "../auth/roles";
import { normPhone } from "../domain/customers";

export interface SearchHit {
  type: "Customer" | "Enquiry" | "Quote" | "Project";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

/** One search used by the global search box and the assistant, filtered by role. */
export async function searchRecords(repo: Repository, role: Role, query: string, limit = 20): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase().slice(0, 80);
  if (q.length < 2) return [];
  const digits = normPhone(q);
  const match = (...vals: (string | null | undefined)[]) => vals.some((v) => v && v.toLowerCase().includes(q));
  const hits: SearchHit[] = [];

  if (can(role, "crm.view")) {
    for (const c of await repo.list("customers")) {
      if (match(c.name, c.email, c.suburb, c.address) || (digits.length >= 4 && normPhone(c.phone).includes(digits)))
        hits.push({ type: "Customer", id: c.id, title: c.name ?? "(no name)", subtitle: [c.suburb, c.phone].filter(Boolean).join(" · "), href: `/customers/${c.id}` });
    }
    for (const e of await repo.list("enquiries")) {
      if (match(e.title, e.serviceRequested)) hits.push({ type: "Enquiry", id: e.id, title: e.title ?? "Enquiry", subtitle: e.status ?? undefined, href: `/customers/${e.customerIds?.[0] ?? ""}` });
    }
  }
  if (can(role, "estimates.view")) {
    for (const e of await repo.list("estimates")) {
      if (match(e.title, e.quoteNumber)) hits.push({ type: "Quote", id: e.id, title: e.title ?? "Estimate", subtitle: e.status ?? undefined, href: `/estimates/${e.id}` });
    }
  }
  if (can(role, "projects.view")) {
    for (const p of await repo.list("projects")) {
      if (match(p.name, p.suburb, p.siteAddress)) hits.push({ type: "Project", id: p.id, title: p.name ?? "Project", subtitle: p.status ?? undefined, href: `/projects/${p.id}` });
    }
  }
  return hits.slice(0, limit);
}
