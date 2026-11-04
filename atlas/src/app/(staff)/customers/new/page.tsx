import { PageHeader } from "@/components/ui";
import { CustomerForm } from "@/components/CustomerForm";
import { getRepo, requirePage } from "@/lib/server/context";
import { loadSuggestions } from "@/lib/server/suggestions";

export const metadata = { title: "New customer" };

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  await requirePage("crm.edit");
  const suggest = await loadSuggestions(getRepo(), ["suburbs", "services"]);
  return (
    <>
      <PageHeader title="New customer" subtitle="ATLAS checks for existing customers with the same email, phone, name or address before saving." />
      <CustomerForm suggest={suggest} />
    </>
  );
}
