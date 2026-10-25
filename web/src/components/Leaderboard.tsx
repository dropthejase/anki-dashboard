import { Crown, Medal } from "lucide-react";
import type { Member } from "../api";
import { timeAgo } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";

function Rank({ rank }: { rank: number }) {
  if (rank === 1) return <Badge variant="gold" aria-label="1st place"><Crown className="h-3 w-3" aria-hidden />1</Badge>;
  if (rank === 2) return <Badge variant="silver" aria-label="2nd place"><Medal className="h-3 w-3" aria-hidden />2</Badge>;
  if (rank === 3) return <Badge variant="bronze" aria-label="3rd place"><Medal className="h-3 w-3" aria-hidden />3</Badge>;
  return <span className="px-2 text-sm text-muted-foreground">{rank}</span>;
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
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-2 font-medium">#</th>
            <th className="py-2 pr-2 font-medium">Member</th>
            <th className="py-2 pr-2 text-right font-medium">Today</th>
            <th className="py-2 pr-2 text-right font-medium">7 days</th>
            {actions && <th className="py-2 text-right font-medium"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr
              key={m.user_id}
              data-testid="member-row"
              className={`border-b border-border/60 transition-colors hover:bg-muted ${m.is_me ? "bg-primary/5" : ""}`}
            >
              <td className="py-3 pr-2"><Rank rank={m.rank} /></td>
              <td className="py-3 pr-2">
                <div className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium">
                    {m.display_name}
                    {m.is_me && <Badge variant="primary">You</Badge>}
                    {m.role === "admin" && <Badge>Admin</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">Updated {timeAgo(m.last_updated)}</span>
                </div>
              </td>
              <td className="py-3 pr-2 text-right font-semibold tabular-nums" data-testid="today">{m.today}</td>
              <td className="py-3 pr-2 text-right tabular-nums text-muted-foreground" data-testid="week">{m.week}</td>
              {actions && <td className="py-3 text-right">{actions(m)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
