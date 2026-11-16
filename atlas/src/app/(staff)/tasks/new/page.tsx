import { PageHeader } from "@/components/ui";
import { TaskForm } from "@/components/crm/TaskForm";
import { getRepo, requirePage } from "@/lib/server/context";
import { loadSuggestions } from "@/lib/server/suggestions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New task" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  await requirePage("crm.edit");
  const { customer } = await searchParams;
  const customers = (await getRepo().list("customers")).map((c) => ({ id: c.id, label: c.name ?? "(no name)" })).sort((a, b) => a.label.localeCompare(b.label));
  return (
    <>
      <PageHeader title="New task" />
      <TaskForm customers={customers} customerId={customers.some((c) => c.id === customer) ? customer : undefined} suggest={await loadSuggestions(getRepo(), ["taskTitles", "people"])} />
    </>
  );
}
