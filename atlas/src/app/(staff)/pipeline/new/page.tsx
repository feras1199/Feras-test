import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { EnquiryForm } from "@/components/crm/EnquiryForm";
import { getRepo, requirePage } from "@/lib/server/context";
import { loadSuggestions } from "@/lib/server/suggestions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New enquiry" };

export default async function NewEnquiryPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  await requirePage("crm.edit");
  const { customer } = await searchParams;
  const customers = (await getRepo().list("customers", { sort: (a, b) => (a.name ?? "").localeCompare(b.name ?? "") })).map((c) => ({ id: c.id, label: [c.name, c.suburb, c.phone].filter(Boolean).join(" · ") }));
  return (
    <>
      <PageHeader title="New enquiry" subtitle="Pick the customer, or add them first if they're new." actions={<Link href="/customers/new" className="btn-secondary">New customer</Link>} />
      <EnquiryForm customers={customers} customerId={customers.some((c) => c.id === customer) ? customer : undefined} suggest={await loadSuggestions(getRepo(), ["services", "nextActions"])} />
    </>
  );
}
