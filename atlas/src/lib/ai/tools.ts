import { z } from "zod";
import type { Repository } from "../data/repository";
import type { Settings } from "../config/settings";
import type { SessionPayload } from "../auth/session";
import { can, type Permission } from "../auth/roles";
import { formatAud, sumCents } from "../finance/money";
import { paymentState } from "../finance/payments";
import { buildToday } from "../domain/today";
import { projectFinancials } from "../domain/projects";
import { summarise } from "../domain/estimates";
import { TaskCreate, TASK_PRIORITIES, TASK_TYPES } from "../domain/crm";
import { addDays } from "../domain/dates";
import { searchRecords } from "../server/search";

export interface ToolContext {
  repo: Repository;
  session: Pick<SessionPayload, "uid" | "name" | "role">;
  settings: Settings;
  today: string;
}

/**
 * A change the assistant suggests. ATLAS never applies it on the model's say-so:
 * the person sees it and presses Confirm, which calls the normal API route with
 * its own permission checks and audit log.
 */
export interface Proposal {
  id: string;
  kind: "task" | "follow-up";
  summary: string;
  endpoint: string;
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
}

export interface ToolOutcome {
  data: unknown;
  proposal?: Proposal;
}

export class ToolError extends Error {}

interface ToolDef {
  name: string;
  description: string;
  perm: Permission;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  run: (input: unknown, ctx: ToolContext) => Promise<ToolOutcome>;
}

const recId = z.string().regex(/^rec[A-Za-z0-9]{14}$/, "Use a record id returned by another tool");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const OPEN_TASK = new Set(["Backlog", "Today", "Doing", "Waiting", "Delayed"]);
const CLOSED_ENQUIRY = new Set(["Won", "Lost", "Not Suitable", "Archived"]);

const aud = (c: number | null | undefined) => (typeof c === "number" ? formatAud(c) : null);
const pct = (r: number | null | undefined) => (typeof r === "number" ? `${(r * 100).toFixed(1)}%` : null);
const clip = (s: string | null | undefined, n = 600) => (s ? (s.length > n ? s.slice(0, n) + "…" : s) : null);

function received(p: { status?: string | null; receivedDate?: string | null; amount?: number | null }) {
  return p.status === "Paid" || p.receivedDate ? p.amount ?? 0 : 0;
}

async function mustGet<T extends Parameters<Repository["get"]>[0]>(repo: Repository, entity: T, id: string) {
  const r = await repo.get(entity, id);
  if (!r) throw new ToolError(`No ${entity} record with id ${id}`);
  return r;
}

export const TOOLS: ToolDef[] = [
  {
    name: "search_records",
    description: "Find customers, enquiries, quotes and projects by name, suburb, address, email, phone or quote number. Returns ids for the other tools. Only returns record types the signed-in person may see.",
    perm: "dashboard.view",
    input_schema: { type: "object", properties: { query: { type: "string", description: "At least 2 characters" } }, required: ["query"], additionalProperties: false },
    async run(input, ctx) {
      const { query } = z.object({ query: z.string().min(2).max(80) }).parse(input);
      const hits = await searchRecords(ctx.repo, ctx.session.role, query, 15);
      return { data: { hits: hits.map(({ type, id, title, subtitle }) => ({ type, id, title, subtitle })), note: hits.length ? undefined : "No matching records." } };
    },
  },
  {
    name: "today_overview",
    description: "What needs attention today: overdue and due follow-ups, tasks, new enquiries, payments due or overdue (if permitted) and active projects.",
    perm: "dashboard.view",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    async run(_input, ctx) {
      const t = await buildToday(ctx.repo, ctx.session.role, ctx.today);
      return {
        data: {
          today: ctx.today,
          items: t.items.slice(0, 30).map((i) => ({ kind: i.kind, id: i.id, title: i.title, detail: i.detail, due: i.due, overdue: i.overdue })),
          counts: t.counts,
          money: t.money ? { dueThisWeek: aud(t.money.dueCents), overdue: aud(t.money.overdueCents), outstanding: aud(t.money.outstandingCents) } : "not permitted",
          activeProjects: t.activeProjects,
        },
      };
    },
  },
  {
    name: "list_enquiries",
    description: "List enquiries in the sales pipeline with status, follow-up date and next action. Defaults to open enquiries.",
    perm: "crm.view",
    input_schema: { type: "object", properties: { include_closed: { type: "boolean" } }, additionalProperties: false },
    async run(input, ctx) {
      const { include_closed } = z.object({ include_closed: z.boolean().optional() }).parse(input ?? {});
      const [enquiries, customers] = await Promise.all([ctx.repo.list("enquiries"), ctx.repo.list("customers")]);
      const cname = new Map(customers.map((c) => [c.id, c.name]));
      const rows = enquiries
        .filter((e) => include_closed || !CLOSED_ENQUIRY.has(e.status ?? ""))
        .sort((a, b) => (a.nextFollowUp ?? "9999").localeCompare(b.nextFollowUp ?? "9999"))
        .slice(0, 60)
        .map((e) => ({ id: e.id, title: e.title, customer: cname.get(e.customerIds?.[0] ?? "") ?? null, customerId: e.customerIds?.[0] ?? null, status: e.status, service: e.serviceRequested, nextFollowUp: e.nextFollowUp ?? null, followUpOverdue: !!e.nextFollowUp && e.nextFollowUp < ctx.today, nextAction: e.nextAction ?? null, assignedTo: e.assignedTo ?? null, lastContact: e.lastContactDate ?? null }));
      return { data: { count: rows.length, enquiries: rows } };
    },
  },
  {
    name: "get_customer",
    description: "A customer's contact details, enquiries, quotes and projects.",
    perm: "crm.view",
    input_schema: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"], additionalProperties: false },
    async run(input, ctx) {
      const { customer_id } = z.object({ customer_id: recId }).parse(input);
      const c = await mustGet(ctx.repo, "customers", customer_id);
      const [enquiries, estimates, projects] = await Promise.all([ctx.repo.list("enquiries"), can(ctx.session.role, "estimates.view") ? ctx.repo.list("estimates") : Promise.resolve([]), ctx.repo.list("projects")]);
      const mine = <T extends { customerIds?: string[] }>(rows: T[]) => rows.filter((r) => r.customerIds?.includes(c.id));
      return {
        data: {
          id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, suburb: c.suburb, preferredContact: c.preferredContact, doNotContact: !!c.doNotContact, lastContact: c.lastContactDate ?? null,
          enquiries: mine(enquiries).map((e) => ({ id: e.id, title: e.title, status: e.status, nextFollowUp: e.nextFollowUp ?? null, nextAction: e.nextAction ?? null, notes: clip(e.notes) })),
          quotes: can(ctx.session.role, "estimates.view") ? mine(estimates).map((e) => ({ id: e.id, quoteNumber: e.quoteNumber, title: e.title, status: e.status, totalIncGst: aud(e.customerTotalIncGst), validUntil: e.validUntil ?? null })) : "not permitted",
          projects: mine(projects).map((p) => ({ id: p.id, name: p.name, status: p.status, health: p.health ?? null })),
        },
      };
    },
  },
  {
    name: "get_project",
    description: "A project's status, progress, next action and upcoming schedule. Money (contract, payments, costs, profit) is included only where the signed-in person is allowed to see it.",
    perm: "projects.view",
    input_schema: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"], additionalProperties: false },
    async run(input, ctx) {
      const { project_id } = z.object({ project_id: recId }).parse(input);
      const p = await mustGet(ctx.repo, "projects", project_id);
      const role = ctx.session.role;
      const of = <T extends { projectIds?: string[] }>(rows: T[]) => rows.filter((r) => r.projectIds?.includes(p.id));
      const [schedule, components, costs, timesheets, variations, payments] = await Promise.all([
        ctx.repo.list("schedule"), ctx.repo.list("components"), ctx.repo.list("actualCosts"), ctx.repo.list("timesheets"), ctx.repo.list("variations"), ctx.repo.list("payments"),
      ]);
      const upcoming = of(schedule)
        .filter((s) => s.status !== "Completed" && s.status !== "Cancelled")
        .sort((a, b) => (a.plannedStart ?? "9999").localeCompare(b.plannedStart ?? "9999"))
        .slice(0, 10)
        .map((s) => ({ title: s.title, type: s.type, status: s.status, plannedStart: s.plannedStart ?? null, plannedFinish: s.plannedFinish ?? null, assignedTo: s.assignedTo ?? null }));
      const data: Record<string, unknown> = {
        id: p.id, name: p.name, status: p.status, health: p.health ?? null, progress: pct(p.progress), suburb: p.suburb, siteAddress: p.siteAddress,
        startDate: p.startDate ?? null, completionDate: p.completionDate ?? null, nextAction: p.nextAction ?? null, nextActionDate: p.nextActionDate ?? null, upcomingSchedule: upcoming,
      };
      const seeMoney = can(role, "finance.view") || can(role, "costs.view") || can(role, "profit.view");
      if (seeMoney) {
        const f = projectFinancials(p, of(components), of(costs), of(timesheets), of(variations), of(payments), ctx.today, ctx.settings.pricing.gstRate);
        data.contractIncGst = { original: aud(f.contract.original), approvedVariations: aud(f.contract.approvedVariations), pendingVariations: aud(f.contract.pendingVariations), current: aud(f.contract.current) };
        if (can(role, "finance.view")) data.payments = { scheduled: aud(f.payments.scheduled), received: aud(f.payments.received), outstanding: aud(f.payments.outstanding), overdue: aud(f.payments.overdue) };
        if (can(role, "costs.view")) data.costsExGst = { estimated: aud(f.estimatedCost), actualSoFar: aud(f.totalCost), costUsedOfEstimate: pct(f.costUsed), unallocated: aud(f.unallocatedCost), personHours: f.personHours, unsubmittedTimesheets: f.unsubmittedTimesheets, likelyDuplicateCostGroups: f.duplicates.length };
        if (can(role, "profit.view")) data.profit = { onFinishedWorkExGst: f.completedCount ? aud(f.completedProfit) : null, finishedComponents: f.completedCount, note: "Profit is only reported for components that are completed with final revenue. Work still underway has no profit figure yet." };
      } else data.money = "not permitted";
      return { data };
    },
  },
  {
    name: "list_payments",
    description: "Customer payment stages, inc GST. filter: overdue, due_soon (next 14 days), not_yet_raised, or outstanding (everything unpaid).",
    perm: "finance.view",
    input_schema: { type: "object", properties: { filter: { type: "string", enum: ["overdue", "due_soon", "not_yet_raised", "outstanding"] } }, required: ["filter"], additionalProperties: false },
    async run(input, ctx) {
      const { filter } = z.object({ filter: z.enum(["overdue", "due_soon", "not_yet_raised", "outstanding"]) }).parse(input);
      const [payments, projects] = await Promise.all([ctx.repo.list("payments"), ctx.repo.list("projects")]);
      const pname = new Map(projects.map((p) => [p.id, p.name]));
      const soon = addDays(ctx.today, 14);
      const rows = payments
        .filter((p) => !p.archived)
        .map((p) => ({ p, state: paymentState({ amount: p.amount ?? 0, received: received(p), dueDate: p.dueDate ?? null }, ctx.today) }))
        .filter(({ p, state }) => (filter === "overdue" ? state === "overdue" : filter === "due_soon" ? state === "due" && (p.dueDate ?? "") <= soon : filter === "not_yet_raised" ? state === "scheduled" : state !== "paid"))
        .sort((a, b) => (a.p.dueDate ?? "9999").localeCompare(b.p.dueDate ?? "9999"));
      return {
        data: {
          filter,
          count: rows.length,
          totalIncGst: aud(sumCents(rows.map((r) => r.p.amount))),
          payments: rows.slice(0, 50).map(({ p, state }) => ({ id: p.id, title: p.title, project: pname.get(p.projectIds?.[0] ?? "") ?? null, amountIncGst: aud(p.amount), dueDate: p.dueDate ?? null, state, invoiceRef: p.invoiceRef ?? null })),
        },
      };
    },
  },
  {
    name: "get_estimate",
    description: "An estimate or quote: status, customer price, payment schedule, warnings and any checks blocking approval. Internal costs and margin only where permitted.",
    perm: "estimates.view",
    input_schema: { type: "object", properties: { estimate_id: { type: "string" } }, required: ["estimate_id"], additionalProperties: false },
    async run(input, ctx) {
      const { estimate_id } = z.object({ estimate_id: recId }).parse(input);
      const e = await mustGet(ctx.repo, "estimates", estimate_id);
      const lines = (await ctx.repo.list("estimateLines")).filter((l) => l.estimateIds?.includes(e.id));
      const s = summarise(e, lines, ctx.settings, { componentTypes: [], measurementsLinked: lines.filter((l) => l.measurementIds?.length).length, today: ctx.today });
      const role = ctx.session.role;
      const data: Record<string, unknown> = {
        id: e.id, quoteNumber: e.quoteNumber, title: e.title, status: e.status, locked: !!e.quoteLocked, validUntil: e.validUntil ?? null, sentDate: e.sentDate ?? null, acceptedDate: e.acceptedDate ?? null,
        customerPrice: { exGst: aud(s.pricing.sellExGst), gst: aud(s.pricing.gst), incGst: aud(s.pricing.sellIncGst) },
        paymentSchedule: s.schedule?.map((st) => ({ stage: st.label, amountIncGst: aud(st.amount) })) ?? s.scheduleErrors,
        lineCount: lines.length,
        warnings: s.warnings,
        blockingChecks: s.blocking.map((c) => ({ check: c.label, detail: c.detail ?? null })),
      };
      if (can(role, "costs.view")) data.costExGst = { direct: aud(s.pricing.directCost), overhead: aud(s.pricing.overhead), contingency: aud(s.pricing.contingency), costBase: aud(s.pricing.costBase), byCategory: Object.fromEntries(Object.entries(s.costByCategory).map(([k, v]) => [k, aud(v)])) };
      if (can(role, "profit.view")) data.margin = { grossProfitExGst: aud(s.pricing.grossProfit), grossMargin: pct(s.pricing.grossMargin), commissionExGst: aud(s.pricing.commission), operatingProfitExGst: aud(s.pricing.operatingProfit), operatingMargin: pct(s.pricing.operatingMargin), markup: pct(s.pricing.markupRate) };
      return { data };
    },
  },
  {
    name: "list_tasks",
    description: "Open tasks with due dates and who they are assigned to. People without CRM access only see their own tasks.",
    perm: "dashboard.view",
    input_schema: { type: "object", properties: { only_mine: { type: "boolean" } }, additionalProperties: false },
    async run(input, ctx) {
      const { only_mine } = z.object({ only_mine: z.boolean().optional() }).parse(input ?? {});
      const all = await ctx.repo.list("tasks");
      const visible = can(ctx.session.role, "crm.view") && !only_mine ? all : all.filter((t) => t.assignedTo === ctx.session.name);
      const rows = visible.filter((t) => OPEN_TASK.has(t.status ?? "")).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
      return { data: { count: rows.length, tasks: rows.slice(0, 50).map((t) => ({ id: t.id, title: t.title, type: t.taskType, priority: t.priority, status: t.status, dueDate: t.dueDate ?? null, overdue: !!t.dueDate && t.dueDate < ctx.today, assignedTo: t.assignedTo ?? null })) } };
    },
  },
  {
    name: "propose_task",
    description: "Suggest a new task. This does NOT create it: the person sees the suggestion and must press Confirm. Tell them it is waiting for their confirmation.",
    perm: "crm.edit",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        task_type: { type: "string", enum: [...TASK_TYPES] },
        priority: { type: "string", enum: [...TASK_PRIORITIES] },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        assigned_to: { type: "string" },
        notes: { type: "string" },
        customer_id: { type: "string" },
        enquiry_id: { type: "string" },
        project_id: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    async run(input, ctx) {
      const i = z.object({ title: z.string(), task_type: z.string().optional(), priority: z.string().optional(), due_date: z.string().optional(), assigned_to: z.string().optional(), notes: z.string().optional(), customer_id: recId.optional(), enquiry_id: recId.optional(), project_id: recId.optional() }).strict().parse(input);
      const body = TaskCreate.parse({ title: i.title, taskType: i.task_type, priority: i.priority, dueDate: i.due_date, assignedTo: i.assigned_to, notes: i.notes, customerId: i.customer_id, enquiryId: i.enquiry_id, projectId: i.project_id });
      if (body.customerId) await mustGet(ctx.repo, "customers", body.customerId);
      if (body.enquiryId) await mustGet(ctx.repo, "enquiries", body.enquiryId);
      if (body.projectId) await mustGet(ctx.repo, "projects", body.projectId);
      const summary = `Create task "${body.title}"${body.dueDate ? ` due ${body.dueDate}` : ""} for ${body.assignedTo || ctx.session.name}`;
      return { data: { status: "proposed, awaiting the person's confirmation", summary }, proposal: { id: "", kind: "task", summary, endpoint: "/api/tasks", method: "POST", body: body as Record<string, unknown> } };
    },
  },
  {
    name: "propose_follow_up",
    description: "Suggest setting an enquiry's next follow-up date and next action. This does NOT change anything until the person presses Confirm.",
    perm: "crm.edit",
    input_schema: {
      type: "object",
      properties: { enquiry_id: { type: "string" }, next_follow_up: { type: "string", description: "YYYY-MM-DD" }, next_action: { type: "string" } },
      required: ["enquiry_id", "next_follow_up", "next_action"],
      additionalProperties: false,
    },
    async run(input, ctx) {
      const i = z.object({ enquiry_id: recId, next_follow_up: isoDate, next_action: z.string().min(2).max(200) }).strict().parse(input);
      const e = await mustGet(ctx.repo, "enquiries", i.enquiry_id);
      if (CLOSED_ENQUIRY.has(e.status ?? "")) throw new ToolError(`Enquiry is ${e.status}; follow-ups only apply to open enquiries`);
      if (i.next_follow_up < ctx.today) throw new ToolError("Follow-up date is in the past");
      const summary = `Set follow-up for "${e.title}" to ${i.next_follow_up}: ${i.next_action}`;
      return { data: { status: "proposed, awaiting the person's confirmation", summary }, proposal: { id: "", kind: "follow-up", summary, endpoint: `/api/enquiries/${e.id}`, method: "PATCH", body: { nextFollowUp: i.next_follow_up, nextAction: i.next_action } } };
    },
  },
];

/** Only the tools this person's role allows are offered to the model at all. */
export function toolsFor(role: SessionPayload["role"]) {
  return TOOLS.filter((t) => can(role, t.perm));
}

/** Runs a tool after re-checking permission. Errors come back as text for the model, never as invented data. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<{ ok: true; outcome: ToolOutcome } | { ok: false; error: string }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Unknown tool ${name}` };
  if (!can(ctx.session.role, tool.perm)) return { ok: false, error: "The signed-in person is not permitted to see this. Tell them so; do not guess the answer." };
  try {
    return { ok: true, outcome: await tool.run(input, ctx) };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: "Invalid input: " + e.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ") };
    if (e instanceof ToolError) return { ok: false, error: e.message };
    console.error("assistant tool failed", name, e);
    return { ok: false, error: "The lookup failed. Say the data could not be loaded; do not guess." };
  }
}
