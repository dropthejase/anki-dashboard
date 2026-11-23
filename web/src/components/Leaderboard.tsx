import { Crown, Medal } from "lucide-react";
import type { Member } from "../api";
import { timeAgo } from "../lib/utils";
import { CountUp } from "./CountUp";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";

function Rank({ rank }: { rank: number }) {
  if (rank === 1) return <Badge variant="gold" aria-label="1st place" className="crown-badge"><Crown className="crown h-3 w-3" aria-hidden />1</Badge>;
  if (rank === 2) return <Badge variant="silver" aria-label="2nd place"><Medal className="h-3 w-3" aria-hidden />2</Badge>;
  if (rank === 3) return <Badge variant="bronze" aria-label="3rd place"><Medal className="h-3 w-3" aria-hidden />3</Badge>;
  return <span className="px-2.5 text-sm text-muted-foreground">{rank}</span>;
}

export function LeaderboardSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label="Loading leaderboard">
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 w-full" />)}
    </div>
  );
}

export function Leaderboard({ members, actions }: { members: Member[]; actions?: (m: Member) => React.ReactNode }) {
  return (
    <div className="-mx-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Member</th>
            <th className="px-3 py-2 text-right font-medium">Today</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">7 days</th>
            {actions && <th className="px-3 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m, i) => (
            <tr
              key={m.user_id}
              data-testid="member-row"
              style={{ "--i": i } as React.CSSProperties}
              className={`row-in border-b border-border/60 transition-colors ${m.is_me ? "bg-emerald-500/10 hover:bg-emerald-500/15" : "hover:bg-muted"}`}
            >
              <td className="px-3 py-3"><Rank rank={m.rank} /></td>
              <td className="px-3 py-3">
                <div className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium">
                    {m.display_name}
                    {m.is_me && <Badge variant="you">You</Badge>}
                    {m.role === "admin" && <Badge>Admin</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">Updated {timeAgo(m.last_updated)}</span>
                </div>
              </td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums"><CountUp value={m.today} data-testid="today" /></td>
              <td className="px-3 py-3 text-right tabular-nums text-muted-foreground"><CountUp value={m.week} data-testid="week" /></td>
              {actions && <td className="px-3 py-3 text-right">{actions(m)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
