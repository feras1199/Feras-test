import { route, HttpError } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { TimesheetCreate, timesheetCost } from "@/lib/domain/projects";
import { assertComponent, getProject } from "@/lib/server/projects";
import { zonedToUtc } from "@/lib/dates";

/** Staff log their own time. The pay rate comes from settings on the server, never from the browser. */
export const POST = route("timesheets.submit", async ({ req, session }) => {
  const i = TimesheetCreate.parse(await req.json());
  const repo = getRepo();
  const settings = getSettings();
  const p = await getProject(repo, i.projectId);
  if (!["In Progress", "Accepted / Pre-start"].includes(p.status ?? "")) throw new HttpError(409, `Time can't be logged on a project that is ${p.status}`);
  const componentIds = await assertComponent(repo, p.id, i.componentId);
  const tz = settings.business.timezone;
  const rec = await repo.create("timesheets", {
    title: `${session.name} – ${i.workDate}`,
    projectIds: [p.id],
    componentIds,
    staffName: session.name,
    workDate: i.workDate,
    start: zonedToUtc(i.workDate, i.startTime, tz),
    finish: zonedToUtc(i.workDate, i.finishTime, tz),
    breakMinutes: i.breakMinutes,
    crewSize: i.crewSize,
    rate: settings.labour.defaultRatePerPersonHourCents,
    rateBasis: "Per Person",
    workType: i.workType,
    reworkReason: i.reworkReason ?? "",
    notes: i.notes ?? "",
    submitted: true,
  });
  const t = timesheetCost(rec);
  audit(session, { action: "timesheet.submit", entity: "timesheets", recordId: rec.id, summary: `${session.name} logged ${t.personHours} person-hours on ${p.name} (${i.workDate})` });
  return { timesheet: { id: rec.id, personHours: t.personHours } };
});
