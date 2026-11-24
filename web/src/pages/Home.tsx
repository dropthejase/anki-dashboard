import { Plus, Users } from "lucide-react";
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
          <CardTitle>A private leaderboard for Anki</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p>
            Compare how many cards you review each day with your friends. You need the free Anki Leaderboard add-on. It runs in Anki on a computer, not on a
            phone, and it only shares your daily review count.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <a
                href="/help#get-started"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/help#get-started");
                }}
                className="font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Install
              </a>{" "}
              the add-on in Anki.
            </li>
            <li>
              In Anki, choose <strong>Tools → Open Leaderboard</strong>. This site opens and signs you in. There is no password.
            </li>
            <li>Create a board and send its invite link to friends, or open an invite link a friend sent you.</li>
          </ol>
          <p className="text-muted-foreground">
            Already set up? Choose <strong>Tools → Open Leaderboard</strong> in Anki.
          </p>
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
