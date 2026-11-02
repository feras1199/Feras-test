import { PageHeader } from "@/components/ui";
import { CustomerForm } from "@/components/CustomerForm";
import { requirePage } from "@/lib/server/context";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  await requirePage("crm.edit");
  return (
    <>
      <PageHeader title="New customer" subtitle="ATLAS checks for existing customers with the same email, phone, name or address before saving." />
      <CustomerForm />
    </>
  );
}
