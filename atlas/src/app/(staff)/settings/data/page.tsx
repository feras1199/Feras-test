import { PageHeader } from "@/components/ui";
import { DataAdmin } from "@/components/settings/DataAdmin";
import { ENTITIES, type EntityName } from "@/lib/data/entities";
import { dataSource, getRepo, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backup and import" };

export default async function DataPage() {
  await requirePage("settings.edit");
  const source = dataSource();
  const repo = getRepo();
  const counts: { label: string; n: number }[] = [];
  for (const e of Object.keys(ENTITIES) as EntityName[]) {
    const n = (await repo.list(e)).length;
    if (n) counts.push({ label: ENTITIES[e].table, n });
  }
  return (
    <>
      <PageHeader title="Backup and import" subtitle="Download everything ATLAS holds, or bring data in from Airtable or an earlier backup." />
      <DataAdmin source={source} counts={counts} serverToken={!!process.env.AIRTABLE_TOKEN} libraryCount={(await repo.list("costItems")).length} />
    </>
  );
}
