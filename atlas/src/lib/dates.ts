/** Today's date (YYYY-MM-DD) in the business timezone, not the server's. */
export function todayIn(timeZone = "Australia/Sydney", now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (Number.isNaN(d.getTime())) return "–";
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: iso.length === 10 ? "UTC" : "Australia/Sydney" }).format(d);
}

/** Convert a local wall-clock date and time in a timezone to a UTC ISO string (handles daylight saving). */
export function zonedToUtc(date: string, time: string, timeZone = "Australia/Sydney"): string {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess).map((p) => [p.type, p.value]));
  const asLocal = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  const offset = asLocal - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

export function formatTime(iso: string | null | undefined, timeZone = "Australia/Sydney"): string {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}
