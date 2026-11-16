import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { TaskForm } from "@/components/crm/TaskForm";
import { DeleteButton } from "@/components/DeleteButton";
import { getRepo, requirePage } from "@/lib/server/context";
import { loadSuggestions } from "@/lib/server/suggestions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit task" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("crm.edit");
  const { id } = await params;
  const repo = getRepo();
  const t = await repo.get("tasks", id);
  if (!t) notFound();
  const customers = (await repo.list("customers")).map((c) => ({ id: c.id, label: c.name ?? "(no name)" })).sort((a, b) => a.label.localeCompare(b.label));
  return (
    <>
      <PageHeader title="Edit task" actions={<DeleteButton entity="tasks" id={t.id} noun="task" />} />
      <TaskForm
        customers={customers}
        customerId={t.customerIds?.[0]}
        suggest={await loadSuggestions(repo, ["taskTitles", "people"])}
        task={{ id: t.id, title: t.title ?? "", taskType: t.taskType ?? "Other", priority: t.priority ?? "Normal", dueDate: t.dueDate ?? "", assignedTo: t.assignedTo ?? "", notes: t.notes ?? "", status: t.status ?? "Backlog" }}
      />
    </>
  );
}
