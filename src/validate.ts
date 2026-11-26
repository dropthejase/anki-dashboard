import { HttpError } from "./http";

export const HEX32 = /^[0-9a-f]{32}$/;
export const DAY_MS = 86_400_000;
export const MAX_REVIEWS_PER_DAY = 10_000;

/** Reject control, format (incl. bidi overrides), private-use and unassigned characters, plus angle brackets. */
const FORBIDDEN = /[\p{C}<>]/u;
/** Four or more combining marks in a row is "zalgo" text, which overflows the layout. Real names rarely need more than three. */
const STACKED_MARKS = /\p{M}{4,}/u;

export function cleanName(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new HttpError(400, `invalid_${field}`);
  const name = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 1 || [...name].length > max || FORBIDDEN.test(name) || STACKED_MARKS.test(name)) {
    throw new HttpError(400, `invalid_${field}`);
  }
  return name;
}

export const displayName = (v: unknown) => cleanName(v, "display_name", 30);
/** A name for a computer, such as "Macbook (macOS)". Optional: a missing label becomes "This computer". */
export const deviceLabel = (v: unknown) => (v === undefined || v === null ? "This computer" : cleanName(v, "device_label", 30));
export const boardName = (v: unknown) => cleanName(v, "board_name", 60);

/** A release number such as 0.2.0, or null for anything else (including unset). */
export function releaseVersion(value: unknown): string | null {
  return typeof value === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value) ? value : null;
}

/** Accepts a recovery code as typed or pasted (any case, spaces or hyphens) and returns its canonical form, or null. */
export function normaliseRecoveryCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const normal = value.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{32}$/.test(normal) ? normal : null;
}

/** Accepts a link code as typed (any case, spaces or hyphens) and returns its canonical form, or null. */
export function normaliseLinkCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32) return null;
  const normal = value.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{12}$/.test(normal) ? normal : null;
}

export const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, days: number): string {
  return utcDate(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS);
}

/** Local dates range from UTC-12 to UTC+14, so accept anything within two days of the server's UTC date. */
export function plausibleDate(date: string, now: number): boolean {
  const diff = Math.abs(new Date(`${date}T00:00:00Z`).getTime() - new Date(`${utcDate(now)}T00:00:00Z`).getTime());
  return diff <= 2 * DAY_MS;
}

export interface Stats {
  days_studied: number;
  retention_today: [number, number];
  retention_week: [number, number];
}

const isCount = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

function pair(v: unknown, max: number): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [passed, failed] = v;
  return isCount(passed, max) && isCount(failed, max) && passed + failed <= max ? [passed, failed] : null;
}

/** Checks the optional statistics an add-on sends: days studied in the last 30, passed and failed review answers today
 *  and in the last 7 days. Anything that does not fit is ignored as a whole, so a glitch in the statistics never blocks
 *  the review count. Other fields are ignored: add-on 1.1.0 also sent a retrievability, which is no longer used. */
export function parseStats(v: unknown): Stats | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  const today = pair(s.retention_today, MAX_REVIEWS_PER_DAY);
  const week = pair(s.retention_week, 7 * MAX_REVIEWS_PER_DAY);
  if (!isCount(s.days_studied, 30) || !today || !week) return null;
  return { days_studied: s.days_studied, retention_today: today, retention_week: week };
}
