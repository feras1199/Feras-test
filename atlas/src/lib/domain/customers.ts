import { z } from "zod";
import type { Rec } from "../data/entities";

export function normPhone(p: string | null | undefined): string {
  let d = (p ?? "").replace(/\D/g, "");
  if (d.startsWith("61")) d = "0" + d.slice(2);
  return d;
}
export function normEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}
function normName(n: string | null | undefined): string {
  return (n ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}
function normAddr(a: string | null | undefined): string {
  return (a ?? "").toLowerCase().replace(/\bstreet\b/g, "st").replace(/\broad\b/g, "rd").replace(/\bavenue\b/g, "ave").replace(/[^a-z0-9]/g, "");
}

export interface DuplicateMatch {
  id: string;
  name: string;
  reasons: string[];
  strength: "strong" | "possible";
}

/** Strong: same email or same phone. Possible: same name, or same street address. */
export function findDuplicates(input: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null }, existing: Rec<"customers">[], excludeId?: string): DuplicateMatch[] {
  const email = normEmail(input.email);
  const phone = normPhone(input.phone);
  const name = normName(input.name);
  const addr = normAddr(input.address);
  const out: DuplicateMatch[] = [];
  for (const c of existing) {
    if (c.id === excludeId) continue;
    const reasons: string[] = [];
    let strong = false;
    if (email && normEmail(c.email) === email) { reasons.push("same email"); strong = true; }
    if (phone.length >= 8 && normPhone(c.phone) === phone) { reasons.push("same phone"); strong = true; }
    if (name && normName(c.name) === name) reasons.push("same name");
    if (addr.length >= 6 && normAddr(c.address) === addr) reasons.push("same address");
    if (reasons.length) out.push({ id: c.id, name: c.name ?? "(no name)", reasons, strength: strong ? "strong" : "possible" });
  }
  return out.sort((a, b) => (a.strength === b.strength ? b.reasons.length - a.reasons.length : a.strength === "strong" ? -1 : 1));
}

const opt = z.string().trim().max(500).optional().transform((v) => (v ? v : undefined));

export const CustomerInput = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  phone: opt.refine((v) => !v || normPhone(v).length >= 8, "Phone number looks too short"),
  email: opt.refine((v) => !v || z.string().email().safeParse(v).success, "Email address is not valid"),
  address: opt,
  suburb: opt,
  preferredContact: z.enum(["Phone", "Email", "SMS", "WhatsApp", "No Preference"]).optional(),
  customerType: z.enum(["Residential", "Commercial", "Government", "Other", "Couple", "Family", "Single"]).optional(),
  leadSource: z.enum(["Word of Mouth", "Hi Pages", "Meta Advertising", "Website", "Google", "Referral", "Social Media"]).optional(),
  serviceRequested: opt,
  /** Set when the user has seen the duplicate warning and chose to create anyway. */
  confirmNotDuplicate: z.boolean().optional(),
});
export type CustomerInput = z.infer<typeof CustomerInput>;
