import { ArrowDown, ArrowRight, Cloud, Link2, Monitor, RefreshCw, Smartphone, Trophy, type LucideIcon } from "lucide-react";
import { Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>
        {n}
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{title}</h3>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

function Flow({ nodes, label }: { nodes: { icon: LucideIcon; text: string }[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col items-center gap-2 rounded-xl border border-border bg-muted p-4 sm:flex-row sm:justify-between">
      {nodes.map((n, i) => (
        <Fragment key={n.text}>
          <li className="flex w-full flex-row items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 sm:w-auto sm:flex-col sm:justify-center sm:gap-1 sm:px-4 sm:py-3">
            <n.icon className="h-6 w-6 text-primary" aria-hidden />
            <span className="text-center text-sm font-medium">{n.text}</span>
          </li>
          {i < nodes.length - 1 && (
            <>
              <ArrowDown className="h-4 w-4 text-muted-foreground sm:hidden" aria-hidden />
              <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
            </>
          )}
        </Fragment>
      ))}
    </ol>
  );
}

export function Help() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
        <p className="text-muted-foreground">Compete with friends on how many Anki cards you review each day.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Get started</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-5">
            <Step n={1} title="Install the add-on">
              In Anki on your computer, add the Anki Leaderboard add-on.
            </Step>
            <Step n={2} title="Sync Anki">
              Press Sync in Anki. This links you to the leaderboard. There is no password to set.
            </Step>
            <Step n={3} title="Open the leaderboard">
              In Anki, choose <strong className="text-foreground">Tools → Open Leaderboard</strong>. Your browser opens and signs you in.
            </Step>
            <Step n={4} title="Make or join a board">
              Create a board and share its invite link. Or open a friend&apos;s invite link to join theirs.
            </Step>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Studying on your phone?</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p>
            Your phone cannot send reviews to the leaderboard. Only Anki on your computer can. Your phone reviews still count, but they show up after
            you sync in this order:
          </p>
          <Flow
            label="How phone reviews reach the leaderboard"
            nodes={[
              { icon: Smartphone, text: "Sync your phone" },
              { icon: Cloud, text: "AnkiWeb" },
              { icon: Monitor, text: "Sync Anki on your computer" },
              { icon: Trophy, text: "Leaderboard updates" },
            ]}
          />
          <p className="text-muted-foreground">
            Signing in also needs Anki on your computer, so you cannot sign in from a phone on its own.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Common questions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 font-medium"><RefreshCw className="h-4 w-4 text-primary" aria-hidden /> My count looks too low</h3>
            <p className="text-muted-foreground">Counts update when Anki on your computer finishes a sync. Sync, then press Refresh on the board.</p>
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 font-medium"><Link2 className="h-4 w-4 text-primary" aria-hidden /> My sign-in link did not work</h3>
            <p className="text-muted-foreground">Links last two minutes and work once. Choose Tools → Open Leaderboard in Anki to get a new one.</p>
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="font-medium">How do I delete my account?</h3>
            <p className="text-muted-foreground">Sign in, go to the home page, and use Delete my account at the bottom. This removes your name, history and boards.</p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
