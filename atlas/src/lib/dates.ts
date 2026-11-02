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
