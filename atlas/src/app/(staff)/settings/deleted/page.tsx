import { Empty, PageHeader } from "@/components/ui";
import { RecycleBinList } from "@/components/settings/RecycleBinList";
import { recycleBinOf } from "@/lib/data/repository";
import { getRepo, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recently deleted" };

export default async function DeletedPage() {
  await requirePage("records.delete");
  const bin = recycleBinOf(getRepo());
  const items = bin ? await bin.listBin(100) : [];
  return (
    <>
      <PageHeader title="Recently deleted" subtitle="Everything deleted in ATLAS is kept here and can be put back." />
      {!bin ? <Empty title="Not available">The recycle bin needs ATLAS&apos;s own database.</Empty> : items.length === 0 ? <Empty title="Nothing deleted yet" /> : (
        <RecycleBinList items={items.map((b) => ({ id: b.id, at: b.at, by: b.by, label: b.label, count: b.records.length, restoredAt: b.restoredAt ?? null, restoredBy: b.restoredBy ?? null, href: hrefFor(b.rootEntity, b.rootId) }))} />
      )}
    </>
  );
}

function hrefFor(entity: string, id: string): string | null {
  const base: Record<string, string> = { customers: "/customers/", inspections: "/inspections/", estimates: "/estimates/", projects: "/projects/" };
  return base[entity] ? base[entity] + id : null;
}
