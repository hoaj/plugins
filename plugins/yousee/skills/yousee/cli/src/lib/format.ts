// Shared by the commands: YouSee's money and date shapes as plain numbers and ISO dates.

/** `{ amount: "1234500", exponent: -4 }` → 123.45 (rounded to øre). */
export const toDKK = (m: { amount: string; exponent: number } | null | undefined): number | null => {
  if (!m) return null;
  const n = Number(m.amount) * 10 ** m.exponent;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** A numeric string (`"149.00"`) → 149, or null. */
export const toNumber = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** An ISO date-time → its date part (`2026-10-18`), or null. */
export const toDate = (s: string | null | undefined): string | null => (s ? s.slice(0, 10) : null);

/** `{ day, month, year }` → `2026-10-18`. */
export const ymd = (d: { day: number; month: number; year: number } | null): string | null =>
  d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null;
