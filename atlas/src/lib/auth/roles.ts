export const ROLES = ["owner", "manager", "sales", "supervisor", "worker", "customer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner / Admin",
  manager: "Manager",
  sales: "Sales / Estimator",
  supervisor: "Supervisor",
  worker: "Worker",
  customer: "Customer",
};

export const PERMISSIONS = [
  "dashboard.view",
  "crm.view",
  "crm.edit",
  "inspections.view",
  "inspections.edit",
  "estimates.view",
  "estimates.edit",
  "estimates.approve", // financial review, overrides, sending quotes
  "projects.view",
  "projects.edit",
  "schedule.edit",
  "checklists.edit",
  "timesheets.submit",
  "timesheets.viewAll",
  "costs.create",
  "costs.view", // internal costs, pay rates
  "profit.view", // margins and profit
  "variations.edit",
  "variations.approve",
  "finance.view",
  "finance.edit",
  "settings.view",
  "settings.edit",
  "users.manage",
  "audit.view",
  "ai.use",
  "portal.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STAFF_BASE: Permission[] = ["dashboard.view", "projects.view", "checklists.edit", "timesheets.submit", "ai.use"];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS.filter((p) => p !== "portal.view")),
  manager: new Set(PERMISSIONS.filter((p) => !["portal.view", "settings.edit", "users.manage"].includes(p))),
  sales: new Set<Permission>([...STAFF_BASE, "crm.view", "crm.edit", "inspections.view", "inspections.edit", "estimates.view", "estimates.edit", "costs.view", "profit.view", "variations.edit"]),
  supervisor: new Set<Permission>([...STAFF_BASE, "crm.view", "inspections.view", "schedule.edit", "timesheets.viewAll", "costs.create", "variations.edit"]),
  worker: new Set<Permission>([...STAFF_BASE]),
  customer: new Set<Permission>(["portal.view"]),
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(perm);
}
