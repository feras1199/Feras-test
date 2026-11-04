import Anthropic from "@anthropic-ai/sdk";
import { HttpError, route } from "@/lib/server/api";
import { getRepo, getSettings } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { todayIn } from "@/lib/dates";
import { ChatInput, runAssistant } from "@/lib/ai/assistant";
import { aiClient, aiConfigured, aiModel, rateLimited } from "@/lib/ai/client";
import { aiDemoMode, demoAssistantClient } from "@/lib/ai/demo";
import { loadAttachments } from "@/lib/server/assistantFiles";

export const maxDuration = 120;

export const POST = route("ai.use", async ({ req, session }) => {
  const demo = aiDemoMode();
  if (!aiConfigured() && !demo) throw new HttpError(503, "The assistant is not set up yet. An administrator needs to add an Anthropic API key.");
  if (rateLimited(session.uid)) throw new HttpError(429, "That's a lot of questions in a short time. Try again in a few minutes.");
  const input = ChatInput.parse(await req.json());
  const settings = getSettings();
  const ctx = { repo: getRepo(), session, settings, today: todayIn(settings.business.timezone) };
  const attachments = await loadAttachments(session, input.messages.flatMap((m) => m.attachmentIds ?? []));
  try {
    const reply = await runAssistant(demo ? demoAssistantClient() : aiClient(), input, ctx, { model: aiModel(), attachments });
    const question = input.messages[input.messages.length - 1]!.content;
    audit(session, { action: "ai.ask", summary: `Asked: ${question.slice(0, 140) || "(shared a file)"}`, after: { lookups: reply.lookups, proposals: reply.proposals.map((p) => p.summary), status: reply.status } });
    return reply;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, "The assistant's API key was rejected. An administrator needs to check it.");
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "The AI service is busy. Try again in a minute.");
    if (e instanceof Anthropic.APIError) {
      console.error("assistant api error", e.status, e.message);
      throw new HttpError(502, "The AI service had a problem. Nothing was changed.");
    }
    throw e;
  }
});
