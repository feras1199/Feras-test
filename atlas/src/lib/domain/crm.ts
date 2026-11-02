import { z } from "zod";
import type { Rec } from "../data/entities";

export const PIPELINE = [
  { status: "New Enquiry", label: "New" },
  { status: "Contacted", label: "Contacted" },
  { status: "Site Visit Booked", label: "Visit booked" },
  { status: "Site Inspected", label: "Inspected" },
  { status: "Estimate Preparing", label: "Estimating" },
  { status: "Preliminary Estimate Ready", label: "Prelim ready" },
  { status: "Proposal Sent", label: "Proposal sent" },
  { status: "Follow-up", label: "Follow-up" },
] as const;
export const CLOSED = ["Won", "Lost", "On Hold"] as const;
export const ENQUIRY_STATUSES = ["New Enquiry", "Contacted", "Site Visit Booked", "Site Inspected", "Estimate Preparing", "Preliminary Estimate Ready", "Proposal Sent", "Follow-up", "Won", "Lost", "On Hold"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
export const LEAD_SOURCES = ["Word of Mouth", "Hi Pages", "Meta Advertising", "Website", "Google", "Referral", "Social Media", "Other"] as const;
export const LOST_REASONS = ["Budget too low", "Price", "No response", "Competitor selected", "Timing", "Scope changed", "Customer postponed", "Not suitable for Whispering Leaf", "Outside service area", "Appointment issue", "Estimate / quote delay", "Other"] as const;

/** Days without contact before an open enquiry is flagged at risk. */
export const STALE_DAYS = 7;

function daysBetween(a: string, b: string) {
  return Math.floor((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

export function isOpen(status: string | null | undefined) {
  return PIPELINE.some((p) => p.status === status);
}

/** Why an open enquiry needs attention, worked out from its dates. Empty list = fine. */
export function enquiryFlags(e: Pick<Rec<"enquiries">, "status" | "nextFollowUp" | "lastContactDate" | "enquiryDate">, today: string): string[] {
  if (!isOpen(e.status)) return [];
  const flags: string[] = [];
  if (!e.nextFollowUp) flags.push("No follow-up date");
  else if (e.nextFollowUp < today) flags.push(`Follow-up ${daysBetween(e.nextFollowUp, today)}d overdue`);
  const last = e.lastContactDate ?? e.enquiryDate;
  if (last && daysBetween(last, today) > STALE_DAYS) flags.push(`No contact for ${daysBetween(last, today)} days`);
  if (e.status === "New Enquiry" && e.enquiryDate && daysBetween(e.enquiryDate, today) >= 1 && !e.lastContactDate) flags.push("Not contacted yet");
  return flags;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const text = (max = 1000) => z.string().trim().max(max);

export const EnquiryCreate = z.object({
  customerId: z.string().regex(/^rec[A-Za-z0-9]{14}$/, "Pick a customer"),
  serviceRequested: text().min(3, "Describe the work"),
  leadSource: z.enum(LEAD_SOURCES).optional(),
  budgetCents: z.number().int().nonnegative().optional(),
  nextFollowUp: date.optional(),
  nextAction: text(200).optional(),
  assignedTo: text(100).optional(),
});

export const EnquiryUpdate = z
  .object({
    status: z.enum(ENQUIRY_STATUSES).optional(),
    reasonWonLost: z.enum([...LOST_REASONS, "Good fit / value"]).optional(),
    nextFollowUp: date.nullable().optional(),
    nextAction: text(200).optional(),
    assignedTo: text(100).optional(),
    leadQuality: z.enum(["High", "Medium", "Low", "Unknown"]).optional(),
    notes: text(5000).optional(),
    /** Record that contact happened today (sets last contact date and logs it). */
    contacted: z.object({ channel: z.enum(["Phone", "Email", "SMS", "WhatsApp", "In Person"]), summary: text(2000).min(2, "Say what was discussed") }).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "Lost" && !v.reasonWonLost) ctx.addIssue({ code: "custom", path: ["reasonWonLost"], message: "Choose why it was lost" });
    if (v.status && isOpen(v.status) && v.nextFollowUp === null) ctx.addIssue({ code: "custom", path: ["nextFollowUp"], message: "Open enquiries need a follow-up date" });
  });

export const TASK_STATUSES = ["Backlog", "Today", "Doing", "Waiting", "Done", "Delayed", "Cancelled"] as const;
export const TASK_TYPES = ["Lead Follow-up", "Site Visit", "Estimate", "Quote Review", "Customer Call", "Material / Supplier", "Construction", "Payment", "Variation", "Customer Update", "Management", "Other"] as const;
export const TASK_PRIORITIES = ["Critical", "High", "Normal", "Low"] as const;

const recId = z.string().regex(/^rec[A-Za-z0-9]{14}$/);
export const TaskCreate = z.object({
  title: text(200).min(3, "Give the task a title"),
  taskType: z.enum(TASK_TYPES).default("Other"),
  priority: z.enum(TASK_PRIORITIES).default("Normal"),
  dueDate: date.optional(),
  assignedTo: text(100).optional(),
  notes: text(5000).optional(),
  customerId: recId.optional(),
  enquiryId: recId.optional(),
  projectId: recId.optional(),
});
export const TaskUpdate = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: date.nullable().optional(),
  assignedTo: text(100).optional(),
  notes: text(5000).optional(),
});
