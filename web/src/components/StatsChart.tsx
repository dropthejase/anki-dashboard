import { useState } from "react";
import type { Member } from "../api";

type StatId = "days" | "today" | "week";

const OPTIONS: { id: StatId; label: string }[] = [
  { id: "days", label: "Days studied (last 30 days)" },
  { id: "today", label: "Retention today" },
  { id: "week", label: "Retention, last 7 days" },
];

/** Below this many review answers a retention figure is mostly noise, so it is drawn fainter. */
export const MIN_RELIABLE_ANSWERS = 20;

interface Entry {
  /** 0 to 100, the length of the bar. Null when the member has no value for this statistic. */
  percent: number | null;
  text: string;
  detail?: string;
  faint?: boolean;
}

const NONE: Entry = { percent: null, text: "\u2014" };

function retention(r: { passed: number; failed: number } | null | undefined): Entry {
  if (!r) return NONE;
  const n = r.passed + r.failed;
  if (n === 0) return NONE;
  const percent = (r.passed / n) * 100;
  return { percent, text: `${Math.round(percent)}%`, detail: `${n} review${n === 1 ? "" : "s"}`, faint: n < MIN_RELIABLE_ANSWERS };
}

export function entryFor(id: StatId, m: Member): Entry {
  const s = m.stats;
  if (!s) return NONE;
  if (id === "days") return { percent: (s.days_studied / 30) * 100, text: `${s.days_studied} / 30` };
  if (id === "today") return retention(s.retention_today);
  return retention(s.retention_week);
}

/** One horizontal bar per member for the chosen Anki statistic, highest first. */
export function StatsChart({ members }: { members: Member[] }) {
  const [stat, setStat] = useState<StatId>("days");
  const rows = members
    .map((m) => ({ m, e: entryFor(stat, m) }))
    .sort((a, b) => (b.e.percent ?? -1) - (a.e.percent ?? -1) || a.m.display_name.localeCompare(b.m.display_name));
  const anyShared = members.some((m) => m.stats !== null);

  return (
    <div data-testid="stats-chart" className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Show</span>
        <select
          value={stat}
          onChange={(e) => setStat(e.target.value as StatId)}
          aria-label="Statistic"
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium"
        >
          {OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </label>
      {!anyShared && <p className="text-sm text-muted-foreground">Nobody has shared statistics yet. They appear after members update the add-on and sync.</p>}
      <ol className="flex flex-col gap-1.5">
        {rows.map(({ m, e }) => (
          <li
            key={m.user_id}
            data-testid="stat-row"
            className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${m.is_me ? "bg-foreground/[0.04]" : ""}`}
          >
            <span className={`w-28 shrink-0 truncate text-sm sm:w-40 ${m.is_me ? "font-semibold" : "font-medium"}`} title={m.display_name}>
              {m.display_name}
              {m.is_me && <span className="sr-only"> (you)</span>}
            </span>
            <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              {e.percent !== null && (
                <span
                  className={`block h-full rounded-full bg-accent ${e.faint ? "opacity-40" : ""}`}
                  style={{ width: `${Math.max(2, Math.min(100, e.percent))}%` }}
                />
              )}
            </span>
            <span
              className={`w-24 shrink-0 text-right text-sm tabular-nums ${e.faint ? "text-muted-foreground" : "font-semibold"}`}
              title={e.faint ? `Fewer than ${MIN_RELIABLE_ANSWERS} reviews, so this is not very reliable` : undefined}
              data-testid="stat-value"
            >
              {e.text}
              {e.detail && <span className="block text-xs font-normal text-muted-foreground">{e.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">
        These come from Anki&apos;s own statistics and update when each member syncs. A dash means not available: the member has not updated the add-on, or
        has no reviews of that kind.
      </p>
    </div>
  );
}
