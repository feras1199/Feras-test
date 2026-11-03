import { z } from "zod";
import type { Rec } from "../data/entities";
import { COST_TYPES, type LineInput } from "./estimates";
import type { CostOption } from "./costLibrary";
import { CustomerInput } from "./customers";

/**
 * Rules for filling ATLAS from something the AI read (a PDF, photo or voice note).
 * The AI only proposes; these run again on the server when the person presses Confirm,
 * so nothing a person typed in the meantime is overwritten.
 */

const recId = z.string().regex(/^rec[A-Za-z0-9]{14}$/);

/** Customer boxes the AI may fill. Name is never changed on an existing customer. */
export const FILLABLE_CUSTOMER_FIELDS = ["phone", "email", "address", "suburb", "serviceRequested"] as const;
export type FillableCustomerField = (typeof FILLABLE_CUSTOMER_FIELDS)[number];
export const CUSTOMER_FIELD_LABELS: Record<FillableCustomerField, string> = { phone: "Phone", email: "Email", address: "Address", suburb: "Suburb", serviceRequested: "What they want" };

export const CustomerFill = CustomerInput.pick({ phone: true, email: true, address: true, suburb: true, serviceRequested: true }).strict();
export type CustomerFill = z.infer<typeof CustomerFill>;

const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** Fills only empty boxes. Anything already saved stays; differences are reported, not applied. */
export function planCustomerFill(current: Partial<Rec<"customers">>, proposed: Partial<CustomerFill>) {
  const updates: Partial<Record<FillableCustomerField, string>> = {};
  const differs: { field: FillableCustomerField; saved: string; inFile: string }[] = [];
  for (const k of FILLABLE_CUSTOMER_FIELDS) {
    const next = proposed[k]?.trim();
    if (!next) continue;
    const now = String((current as Record<string, unknown>)[k] ?? "").trim();
    if (!now) updates[k] = next;
    else if (!same(now, next)) differs.push({ field: k, saved: now, inFile: next });
  }
  return { updates, differs };
}

/** One estimate line the AI suggests. Prices come from the Cost Library whenever costItemId is set. */
export const AiLine = z
  .object({
    costItemId: recId.optional(),
    description: z.string().trim().min(2).max(300),
    quantity: z.number().positive().max(1_000_000),
    unit: z.string().trim().max(30).optional(),
    costType: z.enum(COST_TYPES).optional(),
    /** Only for lines with no Cost Library item, and only when the price is written in the shared file. */
    unitPriceCents: z.number().int().nonnegative().max(100_000_000).optional(),
    priceIncludesGst: z.boolean().optional(),
    /** Where the quantity (and any price) came from, e.g. "Supplier quote PDF, page 2". */
    source: z.string().trim().min(2).max(300),
  })
  .strict()
  .refine((l) => !(l.costItemId && l.unitPriceCents !== undefined), "Lines from the Cost Library use the library's price; leave unitPriceCents out");
export type AiLine = z.infer<typeof AiLine>;

export const AiLinesInput = z
  .object({
    lines: z.array(AiLine).min(1).max(30),
    /** Written into the estimate's customer scope only if that box is still empty. */
    customerScope: z.string().trim().min(10).max(4000).optional(),
  })
  .strict();
export type AiLinesInput = z.infer<typeof AiLinesInput>;

/** Builds a normal estimate line from the AI's suggestion. Always flagged as AI suggested and unchecked. */
export function aiLineToInput(l: AiLine, item: CostOption | null): LineInput {
  if (l.costItemId && !item) throw new Error("That Cost Library item no longer exists");
  const costType = l.costType ?? item?.lineType ?? "Material";
  const labour = costType === "Labour";
  const fromLibrary = !!item;
  const unitCostCents = fromLibrary ? item!.priceIncCents ?? 0 : l.unitPriceCents ?? 0;
  const priceNote = fromLibrary
    ? item!.priceIncCents === null ? " No price in the Cost Library yet." : ""
    : l.unitPriceCents !== undefined ? " Price taken from the shared file, check it." : " No price yet.";
  return {
    description: fromLibrary ? item!.name : l.description,
    costType,
    quantity: l.quantity,
    unit: (fromLibrary ? item!.unit : l.unit ?? "") || (labour ? "person-hour" : ""),
    wasteRate: 0,
    unitCostCents,
    priceIncludesGst: labour ? false : fromLibrary ? true : l.priceIncludesGst ?? true,
    proposalOption: "Included",
    quantityVerified: false,
    costItemId: item?.id,
    notes: `AI suggested from ${l.source}.${fromLibrary && !same(l.description, item!.name) ? ` In the file: "${l.description}".` : ""} Check the quantity.${priceNote}`.slice(0, 2000),
  };
}
