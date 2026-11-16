import { PageHeader } from "@/components/ui";
import { NewEstimateForm } from "@/components/estimates/NewEstimateForm";
import { isOpen } from "@/lib/domain/crm";
import { getRepo, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "New estimate" };

export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<{ customer?: string; enquiry?: string }> }) {
  await requirePage("estimates.edit");
  const sp = await searchParams;
  const repo = getRepo();
  const [customers, enquiries] = await Promise.all([repo.list("customers"), repo.list("enquiries")]);
  return (
    <>
      <PageHeader title="New estimate" subtitle="Starts a draft with your standard markup, GST and payment schedule." />
      <NewEstimateForm
        customers={customers.map((c) => ({ id: c.id, label: [c.name, c.suburb].filter(Boolean).join(" · ") })).sort((a, b) => a.label.localeCompare(b.label))}
        enquiries={enquiries.filter((e) => isOpen(e.status)).map((e) => ({ id: e.id, customerId: e.customerIds?.[0] ?? "", label: e.title ?? "Enquiry", service: e.serviceRequested ?? "" }))}
        customerId={sp.customer}
        enquiryId={sp.enquiry}
      />
    </>
  );
}
