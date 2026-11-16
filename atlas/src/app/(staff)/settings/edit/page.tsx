import { PageHeader } from "@/components/ui";
import { SettingsEditor } from "@/components/settings/SettingsEditor";
import { getSettings, requirePage } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit settings" };

export default async function EditSettingsPage() {
  await requirePage("settings.edit");
  return (
    <>
      <PageHeader title="Edit settings" subtitle="Prices, percentages and payment schedules ATLAS uses." />
      <SettingsEditor initial={await getSettings()} />
    </>
  );
}
