import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SessionPayload } from "../auth/session";
import { fileStoreOf } from "../data/repository";
import { aiClient, aiConfigured, aiModel } from "../ai/client";
import { aiDemoMode, demoClient, demoTranscript } from "../ai/demo";
import { NOTE_FIELDS, NOTE_KEYS, draftSiteNotes, planFill, type NoteField } from "../ai/siteNotes";
import { can } from "../auth/roles";
import { CUSTOMER_FIELD_LABELS, planCustomerFill } from "../domain/aiFill";
import { findDuplicates } from "../domain/customers";
import { MeasurementInput } from "../domain/inspections";
import { transcribe, transcriptionProvider, TranscriptionError } from "../ai/transcribe";
import { HttpError } from "./api";
import { audit } from "./audit";
import { getRepo } from "./context";

/** What the inspection page needs to know to offer the AI write-up. */
export function voiceAiStatus() {
  const demo = aiDemoMode();
  return { demo, transcription: demo || !!transcriptionProvider(), writeUp: demo || aiConfigured() };
}

/**
 * Turns the inspection's voice notes into text (any not done yet), then has
 * the AI fill the site-note boxes and write a meeting summary. Boxes a person
 * has typed in are never overwritten.
 */
export async function fillFromVoiceNotes(inspectionId: string, session: SessionPayload) {
  const repo = getRepo();
  const files = fileStoreOf(repo);
  if (!files) throw new HttpError(409, "Voice notes need ATLAS's own database.");
  const insp = await repo.get("inspections", inspectionId);
  if (!insp) throw new HttpError(404, "Inspection not found");
  const status = voiceAiStatus();
  if (!status.transcription) throw new HttpError(503, "Turning voice notes into text isn't set up yet. The owner needs to add a transcription key on the server (see Settings).");
  if (!status.writeUp) throw new HttpError(503, "The AI write-up isn't set up yet. The owner needs to add an Anthropic API key on the server.");

  const enquiry = insp.enquiryIds?.[0] ? await repo.get("enquiries", insp.enquiryIds[0]) : null;
  const customer = insp.customerIds?.[0] ? await repo.get("customers", insp.customerIds[0]) : null;
  const voices = (await files.listFiles("inspections", inspectionId)).filter((f) => f.kind === "voice" && !f.archived);
  if (!voices.length) throw new HttpError(409, "There are no voice notes on this inspection yet.");

  let transcribed = 0;
  for (const [i, v] of voices.entries()) {
    if (v.transcript !== undefined) continue;
    let text: string;
    if (status.demo) {
      text = demoTranscript(enquiry?.serviceRequested ?? insp.scope ?? "", i);
    } else {
      const f = await files.getFile(v.id);
      if (!f) continue;
      try {
        text = (await transcribe(f.bytes, f.meta.mime)).text;
      } catch (e) {
        if (e instanceof TranscriptionError) throw new HttpError(e.status === 503 ? 503 : 502, e.message);
        throw new HttpError(502, "Couldn't reach the transcription service. Check the signal and try again.");
      }
    }
    v.transcript = text;
    await files.setFileTranscript(v.id, text);
    transcribed++;
  }
  const transcripts = voices.filter((v) => v.transcript?.trim()).map((v) => ({ name: v.name, text: v.transcript! }));
  if (!transcripts.length) throw new HttpError(422, "No speech was picked up in the voice notes. Try recording closer to the phone.");

  let draft;
  try {
    draft = await draftSiteNotes(status.demo ? demoClient() : aiClient(), { transcripts, customerName: customer?.name ?? undefined, enquiry: enquiry?.serviceRequested ?? undefined }, { model: aiModel() });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, "The Anthropic API key was rejected. The owner needs to check it.");
    if (e instanceof Anthropic.APIError) throw new HttpError(502, "The AI service had a problem. Nothing was changed. Try again in a minute.");
    throw new HttpError(502, (e as Error).message || "The AI write-up failed. Nothing was changed.");
  }

  let previous: Partial<Record<NoteField, string>> = {};
  try { previous = JSON.parse(insp.aiFilledJson ?? "{}"); } catch { previous = {}; }
  // Booking copies the enquiry's request into "What the customer wants"; that text came from ATLAS, not a person, so the AI may improve it.
  if (!previous.scope && enquiry?.serviceRequested && (insp.scope ?? "").trim() === enquiry.serviceRequested.trim()) previous = { ...previous, scope: enquiry.serviceRequested };
  const current = Object.fromEntries(NOTE_KEYS.map((k) => [k, (insp as Record<string, unknown>)[k] as string | null]));
  const plan = planFill(current, previous, draft);
  const update: Record<string, unknown> = {
    ...plan.updates,
    aiMeetingSummary: draft.summary,
    aiFilledJson: JSON.stringify({ ...previous, ...plan.updates }),
    transcript: transcripts.map((t) => `${t.name}\n${t.text}`).join("\n\n"),
    transcriptReviewed: false,
  };
  const label = (k: NoteField) => NOTE_FIELDS[k];
  const filled: string[] = plan.filled.map(label);
  const kept: string[] = plan.kept.map(label);
  if (draft.accessDifficulty && !insp.accessDifficulty) { update.accessDifficulty = draft.accessDifficulty; filled.push("Access difficulty"); }
  if (draft.accessWidthM !== undefined && (insp.accessWidthM === null || insp.accessWidthM === undefined)) { update.accessWidthM = draft.accessWidthM; filled.push("Access width"); }
  if (draft.budgetDollars !== undefined && (insp.budget === null || insp.budget === undefined)) { update.budget = draft.budgetDollars * 100; filled.push("Budget"); }
  await repo.update("inspections", inspectionId, update as never);

  // Customer contact details: empty boxes only, and only for people allowed to edit customers.
  const notSaved: string[] = [];
  if (customer && draft.customer) {
    const { updates, differs } = planCustomerFill(customer, draft.customer);
    const keys = Object.keys(updates) as (keyof typeof updates)[];
    if (keys.length && !can(session.role, "crm.edit")) {
      notSaved.push(...keys.map((k) => `customer ${CUSTOMER_FIELD_LABELS[k].toLowerCase()} (you can't edit customers)`));
    } else if (keys.length) {
      const dupes = findDuplicates({ ...customer, ...updates }, await repo.list("customers"), customer.id).filter((d) => d.strength === "strong");
      if (dupes.length) notSaved.push(`customer details (another customer, ${dupes[0]!.name}, already has them)`);
      else {
        await repo.update("customers", customer.id, updates);
        filled.push(...keys.map((k) => `Customer ${CUSTOMER_FIELD_LABELS[k].toLowerCase()}`));
        audit(session, { action: "customer.ai_fill", entity: "customers", recordId: customer.id, summary: `Filled ${keys.map((k) => CUSTOMER_FIELD_LABELS[k]).join(", ")} on ${customer.name} from a site visit recording`, before: Object.fromEntries(keys.map((k) => [k, null])), after: updates });
      }
    }
    kept.push(...differs.map((d) => `customer ${CUSTOMER_FIELD_LABELS[d.field].toLowerCase()} (recording says ${d.inFile})`));
  }

  // Sizes that were said out loud become measurements marked "AI-assisted, Low / Verify", never ticked as verified.
  let measurementsAdded = 0;
  if (draft.measurements?.length) {
    const existing = new Set((await repo.list("measurements")).filter((m) => m.inspectionIds?.includes(inspectionId)).map((m) => (m.title ?? "").toLowerCase()));
    for (const m of draft.measurements) {
      const parsed = MeasurementInput.safeParse({ zone: m.zone, workType: m.workType, unit: m.unit, lengthM: m.lengthM ?? null, widthM: m.widthM ?? null, heightM: m.heightM ?? null, measuredQuantity: m.quantity ?? null, method: "AI-assisted", confidence: "Low / Verify", estimatorNotes: `From the recording: ${m.note || "size mentioned"}. Check on site.`.slice(0, 1000), verified: false });
      if (!parsed.success) continue;
      const title = `${parsed.data.zone} – ${parsed.data.workType}`;
      if (existing.has(title.toLowerCase())) continue;
      existing.add(title.toLowerCase());
      await repo.create("measurements", { ...parsed.data, title, inspectionIds: [insp.id], projectIds: insp.projectIds ?? [] });
      measurementsAdded++;
    }
    if (measurementsAdded) filled.push(`${measurementsAdded} measurement${measurementsAdded === 1 ? "" : "s"} (marked Low / Verify)`);
  }

  // What the recording didn't cover, so the person knows what to fill in by hand.
  const after = { ...insp, ...update } as Record<string, unknown>;
  const blank: string[] = NOTE_KEYS.filter((k) => !String(after[k] ?? "").trim()).map(label);
  if (customer) {
    const c = { ...customer, ...(await repo.get("customers", customer.id)) } as Record<string, unknown>;
    for (const k of ["phone", "email", "address", "suburb"] as const) if (!String(c[k] ?? "").trim()) blank.push(`Customer ${CUSTOMER_FIELD_LABELS[k].toLowerCase()}`);
  }

  audit(session, { action: "inspection.ai_fill", entity: "inspections", recordId: inspectionId, summary: `${insp.title ?? "Inspection"}: AI wrote up ${transcripts.length} voice note(s)${status.demo ? " (demo stand-in)" : ""}; filled ${filled.join(", ") || "nothing new"}${kept.length ? `; kept saved values in ${kept.join(", ")}` : ""}` });
  return { transcribed, filled, kept, notSaved, blank, measurementsAdded, summary: draft.summary, demo: status.demo };
}
