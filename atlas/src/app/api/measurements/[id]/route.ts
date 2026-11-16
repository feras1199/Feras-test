import { route, HttpError } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { MeasurementInput, measurementQuantity } from "@/lib/domain/inspections";

export const PATCH = route<{ id: string }>("inspections.edit", async ({ req, params, session }) => {
  const i = MeasurementInput.parse(await req.json());
  const repo = getRepo();
  const before = await repo.get("measurements", params.id);
  if (!before) throw new HttpError(404, "Measurement not found");
  const after = await repo.update("measurements", params.id, { ...i, title: `${i.zone} – ${i.workType}` });
  audit(session, { action: "measurement.update", entity: "measurements", recordId: params.id, summary: `${after.title}: ${measurementQuantity(before)} → ${measurementQuantity(i)} ${i.unit}` });
  return { measurement: after };
});
