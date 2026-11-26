export type RankBy = "today" | "week";
/** The board's three views. Today and 7 days rank by a count. Stats compares Anki statistics. */
export type BoardTab = RankBy | "stats";

const TABS: { id: BoardTab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
  { id: "stats", label: "Stats" },
];

/** Switches between the board's views. */
export function RankTabs({ value, onChange }: { value: BoardTab; onChange: (tab: BoardTab) => void }) {
  return (
    <div role="tablist" aria-label="Board view" className="mb-3 inline-flex rounded-lg border border-border bg-muted p-0.5">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            value === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
