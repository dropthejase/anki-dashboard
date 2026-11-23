import { Flame, Target, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import type { Member } from "../api";
import { CountUp } from "./CountUp";

function Tile({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm transition-transform hover:-translate-y-0.5">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-accent" aria-hidden /> {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums tracking-tight">{children}</span>
    </div>
  );
}

function nudge(me: Member, members: Member[]): string {
  const above = members.find((m) => m.rank === me.rank - 1);
  if (above) {
    const gap = above.today - me.today;
    return gap > 0 ? `${gap} card${gap === 1 ? "" : "s"} behind ${above.display_name}` : `Level with ${above.display_name} today`;
  }
  const below = members.find((m) => m.rank === me.rank + 1);
  if (!below) return "Invite a friend to compete";
  const lead = me.today - below.today;
  return lead > 0 ? `${lead} card${lead === 1 ? "" : "s"} ahead of ${below.display_name}` : `Level with ${below.display_name} today`;
}

export function BoardStats({ members, total }: { members: Member[]; total: number }) {
  const me = members.find((m) => m.is_me);
  if (!me) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="board-stats">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile icon={Trophy} label="Your rank">
          #{me.rank} <span className="text-base font-normal text-muted-foreground">of {total}</span>
        </Tile>
        <Tile icon={Flame} label="Today">
          <CountUp value={me.today} />
        </Tile>
        <Tile icon={TrendingUp} label="7 days">
          <CountUp value={me.week} />
        </Tile>
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Target className="h-4 w-4 text-accent" aria-hidden /> {nudge(me, members)}
      </p>
    </div>
  );
}
