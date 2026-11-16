import { PageHeader } from "@/components/ui";
import { ChangePassword } from "@/components/settings/ChangePassword";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { allUsers } from "@/lib/auth/users";
import { requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account" };

export default async function AccountPage() {
  const s = await requirePage("dashboard.view");
  const me = (await allUsers()).find((u) => u.id === s.uid);
  return (
    <>
      <PageHeader title="My account" />
      <section className="card max-w-lg p-5">
        <dl className="mb-4 text-sm">
          <div className="flex justify-between py-1"><dt className="text-stone-600">Name</dt><dd className="font-medium">{s.name}</dd></div>
          <div className="flex justify-between py-1"><dt className="text-stone-600">Email</dt><dd className="break-all font-medium">{me?.email}</dd></div>
          <div className="flex justify-between py-1"><dt className="text-stone-600">Role</dt><dd className="font-medium">{ROLE_LABELS[s.role]}</dd></div>
        </dl>
        {me?.source === "database" ? <ChangePassword /> : <p className="text-sm text-stone-600">Your password is set on the server{me?.source === "host" && s.role === "owner" ? " (ATLAS_OWNER_PASSWORD in Render). Change it there and redeploy." : ". Ask the owner to change it."}</p>}
      </section>
    </>
  );
}
