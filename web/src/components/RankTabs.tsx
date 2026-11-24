export type RankBy = "today" | "week";

const TABS: { id: RankBy; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
];

/** Switches the board between ranking by today's count and by the last seven days. */
export function RankTabs({ value, onChange }: { value: RankBy; onChange: (by: RankBy) => void }) {
  return (
    <div role="tablist" aria-label="Rank by" className="mb-3 inline-flex rounded-lg border border-border bg-muted p-0.5">
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
