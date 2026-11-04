import { PageHeader } from "@/components/ui";
import { PeopleAdmin } from "@/components/settings/PeopleAdmin";
import { ROLE_LABELS, ROLES } from "@/lib/auth/roles";
import { hasUserStore } from "@/lib/auth/users";
import { getRepo, requirePage } from "@/lib/server/context";
import { listPeople } from "@/lib/server/people";

export const dynamic = "force-dynamic";
export const metadata = { title: "People and logins" };

export default async function PeoplePage() {
  const s = await requirePage("users.manage");
  const [people, customers] = await Promise.all([listPeople(), getRepo().list("customers")]);
  return (
    <>
      <PageHeader title="People and logins" subtitle="Who can sign in to ATLAS, and what they can see." />
      <PeopleAdmin
        me={s.uid}
        canEdit={hasUserStore()}
        people={people}
        roles={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        customers={customers.map((c) => ({ id: c.id, name: c.name ?? "", suburb: c.suburb ?? "" })).filter((c) => c.name).sort((a, b) => a.name.localeCompare(b.name))}
      />
    </>
  );
}
