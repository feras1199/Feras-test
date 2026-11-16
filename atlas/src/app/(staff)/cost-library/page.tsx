import { PageHeader } from "@/components/ui";
import { CostLibraryAdmin, type LibraryRow } from "@/components/costs/CostLibraryAdmin";
import { toCostOption } from "@/lib/domain/costLibrary";
import { can } from "@/lib/auth/roles";
import { getRepo, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cost Library" };

export default async function CostLibraryPage() {
  const s = await requirePage("costs.view");
  const items = await getRepo().list("costItems");
  const rows: LibraryRow[] = [];
  for (const c of items) {
    const o = toCostOption(c);
    if (!o) continue;
    rows.push({ ...o, sku: c.sku ?? "", notes: c.notes ?? "", updated: c.priceUpdatedDate ?? null, source: c.priceSource ?? "", needsUpdate: !!c.needsPriceUpdate });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title="Cost Library" subtitle={`${rows.length.toLocaleString("en-AU")} items · prices include GST`} />
      <CostLibraryAdmin rows={rows} canEdit={can(s.role, "costs.manage")} />
    </>
  );
}
