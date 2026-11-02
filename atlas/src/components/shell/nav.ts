import type { Permission } from "@/lib/auth/roles";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // key into ICONS
  perm: Permission;
}

/** Only modules that actually work are listed. New modules are added as they ship. */
export const NAV: NavItem[] = [
  { href: "/", label: "Today", icon: "home", perm: "dashboard.view" },
  { href: "/pipeline", label: "Pipeline", icon: "pipeline", perm: "crm.view" },
  { href: "/customers", label: "Customers", icon: "users", perm: "crm.view" },
  { href: "/inspections", label: "Inspections", icon: "ruler", perm: "inspections.view" },
  { href: "/estimates", label: "Estimates", icon: "calc", perm: "estimates.view" },
  { href: "/projects", label: "Projects", icon: "hammer", perm: "projects.view" },
  { href: "/finance", label: "Finance", icon: "money", perm: "finance.view" },
  { href: "/timesheets", label: "My time", icon: "clock", perm: "timesheets.submit" },
  { href: "/tasks", label: "Tasks", icon: "check", perm: "dashboard.view" },
  { href: "/assistant", label: "Ask ATLAS", icon: "spark", perm: "ai.use" },
  { href: "/settings", label: "Settings", icon: "settings", perm: "settings.view" },
  { href: "/audit", label: "Audit log", icon: "shield", perm: "audit.view" },
];
