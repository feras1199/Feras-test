import { HttpError, route } from "@/lib/server/api";
import { rateLimited } from "@/lib/ai/client";
import { fillFromVoiceNotes } from "@/lib/server/voiceNotes";

export const maxDuration = 300;

/** Transcribe this inspection's voice notes and let the AI fill the empty site-note boxes plus a summary. */
export const POST = route<{ id: string }>("inspections.edit", async ({ params, session }) => {
  if (rateLimited(`fill:${session.uid}`, Date.now(), 15)) throw new HttpError(429, "That's a lot of write-ups in a short time. Try again in a few minutes.");
  return fillFromVoiceNotes(params.id, session);
});
