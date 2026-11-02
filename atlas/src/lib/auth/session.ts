/**
 * Stateless signed session token: base64url(JSON payload) + "." + HMAC-SHA256.
 * Uses Web Crypto so it works in both middleware and route handlers.
 */
import type { Role } from "./roles";

export const SESSION_COOKIE = "atlas_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface SessionPayload {
  uid: string;
  name: string;
  role: Role;
  /** For customer logins: the only customer record they can see. */
  customerId?: string;
  exp: number; // unix seconds
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

async function key(secret: string) {
  if (!secret || secret.length < 32) throw new Error("ATLAS_SESSION_SECRET must be at least 32 characters");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(p: Omit<SessionPayload, "exp">, secret: string, ttl = SESSION_TTL_SECONDS): Promise<string> {
  const payload: SessionPayload = { ...p, exp: Math.floor(Date.now() / 1000) + ttl };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    if (typeof p.exp !== "number" || p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}
