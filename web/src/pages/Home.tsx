import { HelpCircle, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import { useSession } from "../App";
import { BoardPicture } from "../components/BoardPicture";
import { SectionLabel } from "../components/SectionLabel";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { navigate } from "../lib/router";
import { hasPendingJoin } from "./Join";

export function Home() {
  const { me, refresh } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me && hasPendingJoin()) navigate("/join");
  }, [me]);

  if (!me) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Open the leaderboard from Anki</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p>There is no password. Your Anki add-on signs you in.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Open Anki on your computer and sync once.</li>
            <li>
              Choose <strong>Tools → Open Leaderboard</strong>.
            </li>
          </ol>
          <a href="/help" onClick={(e) => { e.preventDefault(); navigate("/help"); }} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
            <HelpCircle className="h-4 w-4" aria-hidden /> New here? Read the help page
          </a>
        </CardContent>
      </Card>
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const b = await api<{ id: string }>("POST", "/api/boards", { name });
      await refresh();
      navigate(`/b/${b.id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section aria-label="Your boards">
        <SectionLabel>Your boards</SectionLabel>
        {me.boards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            You are not on any board yet. Create one below, or open an invite link.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {me.boards.map((b) => (
              <li key={b.id}>
                <a
                  href={`/b/${b.id}`}
                  onClick={(e) => { e.preventDefault(); navigate(`/b/${b.id}`); }}
                  className="group flex h-full items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-md"
                >
                  {/* The name has its own shrinkable area, so a long name wraps or is cut off and never runs under the picture. */}
                  <span className="flex min-w-0 flex-1 flex-col gap-3 self-stretch">
                    <span className="line-clamp-2 break-words text-base font-semibold tracking-tight">{b.name}</span>
                    <span className="mt-auto flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden />{b.member_count}</span>
                      {b.role === "admin" && <Badge variant="primary">Admin</Badge>}
                    </span>
                  </span>
                  <BoardPicture boardId={b.id} name={b.name} version={b.image_version} className="h-12 w-12" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Create a board">
        <SectionLabel>Create a board</SectionLabel>
        <form onSubmit={create} className="flex flex-col gap-3 rounded-xl bg-muted p-4 sm:flex-row">
          <Input aria-label="Board name" placeholder="e.g. SQE1 study group" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
          <Button type="submit" disabled={busy} className="sm:w-28 sm:shrink-0">
            <Plus className="h-4 w-4" aria-hidden /> Create
          </Button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </section>
    </>
  );
}
