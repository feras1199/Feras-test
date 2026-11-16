import { Shell } from "@/components/shell/Shell";
import { NAV } from "@/components/shell/nav";
import { can, ROLE_LABELS } from "@/lib/auth/roles";
import { dataSource, requirePage } from "@/lib/server/context";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePage("dashboard.view");
  return (
    <Shell nav={NAV.filter((n) => can(s.role, n.perm))} user={{ name: s.name, roleLabel: ROLE_LABELS[s.role] }} demo={dataSource() === "memory"} canCreate={can(s.role, "crm.edit")}>
      {children}
    </Shell>
  );
}
