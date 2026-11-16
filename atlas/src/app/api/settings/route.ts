import { HttpError, route } from "@/lib/server/api";
import { audit } from "@/lib/server/audit";
import { getSettingsWithMeta, saveSettings } from "@/lib/server/context";
import { applySettingsEdit, SettingsEdit, settingsChanges } from "@/lib/config/settings";

export const GET = route("settings.view", async () => {
  const { settings, meta } = await getSettingsWithMeta();
  return { settings, meta };
});

/**
 * Owner changes the business rules. New and draft estimates use them from now on;
 * approved quotes keep the rules saved in their snapshot.
 */
export const PUT = route("settings.edit", async ({ req, session }) => {
  const edit = SettingsEdit.parse(await req.json());
  const { settings: before } = await getSettingsWithMeta();
  let after;
  try {
    after = applySettingsEdit(before, edit);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const changes = settingsChanges(before, after);
  if (!changes.length) return { settings: before, changed: 0 };
  await saveSettings(after, session.name);
  const sections = [...new Set(changes.map((c) => c.path.split(".")[0]))];
  audit(session, {
    action: "settings.update",
    entity: "settings",
    summary: `Changed ${changes.length} setting${changes.length === 1 ? "" : "s"} (${sections.join(", ")})`,
    before: Object.fromEntries(changes.map((c) => [c.path, c.from])),
    after: Object.fromEntries(changes.map((c) => [c.path, c.to])),
  });
  return { settings: after, changed: changes.length };
});
