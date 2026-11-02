import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { MessagesClient } from "./assistant";

const g = globalThis as unknown as { __atlasAi?: Anthropic };

export function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function aiModel() {
  return process.env.ATLAS_AI_MODEL || undefined;
}

/** The API key is read on the server only and never sent to the browser. */
export function aiClient(): MessagesClient {
  g.__atlasAi ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  return g.__atlasAi as unknown as MessagesClient;
}

const hits = new Map<string, number[]>();
/** Simple per-person limit so one user can't run up the bill: 20 questions per 10 minutes. */
export function rateLimited(uid: string, now = Date.now(), max = 20, windowMs = 600_000) {
  const recent = (hits.get(uid) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(uid, recent);
    return true;
  }
  recent.push(now);
  hits.set(uid, recent);
  return false;
}
