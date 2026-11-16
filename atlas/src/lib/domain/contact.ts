/** Links that open the phone's own apps: call, WhatsApp, email and Google Maps. */

/** Digits only, in international form for Australia: "0491 570 156" -> "61491570156". */
export function internationalAu(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const plus = phone.trim().startsWith("+");
  let d = phone.replace(/\D/g, "");
  if (!d) return null;
  if (!plus) {
    if (d.startsWith("0")) d = "61" + d.slice(1);
    else if (!d.startsWith("61") && d.length === 9) d = "61" + d; // "491 570 156"
  }
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export function telUrl(phone: string | null | undefined): string | null {
  const d = internationalAu(phone);
  return d ? `tel:+${d}` : null;
}

export function whatsappUrl(phone: string | null | undefined): string | null {
  const d = internationalAu(phone);
  return d ? `https://wa.me/${d}` : null;
}

export function mailUrl(email: string | null | undefined): string | null {
  const e = email?.trim();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? `mailto:${e}` : null;
}

export function mapsUrl(...parts: (string | null | undefined)[]): string | null {
  const q = parts.map((p) => p?.trim()).filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q + (/\b(NSW|Australia)\b/i.test(q) ? "" : ", NSW, Australia"))}` : null;
}
