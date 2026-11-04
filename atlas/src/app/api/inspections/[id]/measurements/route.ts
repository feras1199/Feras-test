import { route, HttpError } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { MeasurementInput, measurementQuantity } from "@/lib/domain/inspections";

export const POST = route<{ id: string }>("inspections.edit", async ({ req, params, session }) => {
  const i = MeasurementInput.parse(await req.json());
  const repo = getRepo();
  const insp = await repo.get("inspections", params.id);
  if (!insp) throw new HttpError(404, "Inspection not found");
  const rec = await repo.create("measurements", { ...i, title: `${i.zone} – ${i.workType}`, inspectionIds: [insp.id], projectIds: insp.projectIds ?? [] });
  audit(session, { action: "measurement.create", entity: "measurements", recordId: rec.id, summary: `${insp.title}: ${rec.title} = ${measurementQuantity(i)} ${i.unit}` });
  return { measurement: rec };
});
