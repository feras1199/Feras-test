import { PageHeader } from "@/components/ui";
import { NewInspectionForm } from "@/components/inspections/NewInspectionForm";
import { isOpen } from "@/lib/domain/crm";
import { todayIn } from "@/lib/dates";
import { getRepo, getSettings, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book inspection" };

export default async function NewInspectionPage({ searchParams }: { searchParams: Promise<{ enquiry?: string; customer?: string }> }) {
  await requirePage("inspections.edit");
  const sp = await searchParams;
  const repo = getRepo();
  const [customers, enquiries] = await Promise.all([repo.list("customers"), repo.list("enquiries")]);
  return (
    <>
      <PageHeader title="Book a site inspection" />
      <NewInspectionForm
        today={todayIn(getSettings().business.timezone)}
        customers={customers.map((c) => ({ id: c.id, label: [c.name, c.suburb].filter(Boolean).join(" · ") })).sort((a, b) => a.label.localeCompare(b.label))}
        enquiries={enquiries.filter((e) => isOpen(e.status)).map((e) => ({ id: e.id, customerId: e.customerIds?.[0] ?? "", label: e.title ?? "Enquiry" }))}
        enquiryId={sp.enquiry}
        customerId={sp.customer}
      />
    </>
  );
}
