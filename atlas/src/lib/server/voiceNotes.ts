import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SessionPayload } from "../auth/session";
import { fileStoreOf } from "../data/repository";
import { aiClient, aiConfigured, aiModel } from "../ai/client";
import { aiDemoMode, demoClient, demoTranscript } from "../ai/demo";
import { NOTE_FIELDS, NOTE_KEYS, draftSiteNotes, planFill, type NoteField } from "../ai/siteNotes";
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
  if (draft.accessDifficulty && !insp.accessDifficulty) update.accessDifficulty = draft.accessDifficulty;
  if (draft.accessWidthM !== undefined && (insp.accessWidthM === null || insp.accessWidthM === undefined)) update.accessWidthM = draft.accessWidthM;
  await repo.update("inspections", inspectionId, update as never);

  const label = (k: NoteField) => NOTE_FIELDS[k];
  audit(session, { action: "inspection.ai_fill", entity: "inspections", recordId: inspectionId, summary: `${insp.title ?? "Inspection"}: AI wrote up ${transcripts.length} voice note(s)${status.demo ? " (demo stand-in)" : ""}; filled ${plan.filled.map(label).join(", ") || "nothing new"}${plan.kept.length ? `; kept your edits in ${plan.kept.map(label).join(", ")}` : ""}` });
  return { transcribed, filled: plan.filled.map(label), kept: plan.kept.map(label), summary: draft.summary, demo: status.demo };
}
