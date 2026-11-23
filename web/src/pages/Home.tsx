import { ChevronRight, HelpCircle, Plus, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import { useSession } from "../App";
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
          <a href="/help" onClick={(e) => { e.preventDefault(); navigate("/help"); }} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
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
      <Card>
        <CardHeader>
          <CardTitle>Your boards</CardTitle>
        </CardHeader>
        <CardContent>
          {me.boards.length === 0 ? (
            <p className="text-muted-foreground">You are not on any board yet. Create one below, or open an invite link.</p>
          ) : (
            <ul className="divide-y divide-border">
              {me.boards.map((b) => (
                <li key={b.id}>
                  <a
                    href={`/b/${b.id}`}
                    onClick={(e) => { e.preventDefault(); navigate(`/b/${b.id}`); }}
                    className="group flex items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted"
                  >
                    <span className="font-medium">{b.name}</span>
                    <span className="flex items-center gap-3 text-muted-foreground">
                      {b.role === "admin" && <Badge variant="primary">Admin</Badge>}
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden />{b.member_count}</span>
                      <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Create a board</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row">
            <Input aria-label="Board name" placeholder="e.g. SQE1 study group" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
            <Button type="submit" disabled={busy}>
              <Plus className="h-4 w-4" aria-hidden /> Create
            </Button>
          </form>
          {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
        </CardContent>
      </Card>
      <Account />
    </>
  );
}

function Account() {
  const { me, refresh } = useSession();
  const [name, setName] = useState(me?.user.display_name ?? "");
  const [msg, setMsg] = useState("");
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your account</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("PATCH", "/api/me", { display_name: name });
              await refresh();
              setMsg("Saved.");
            } catch (err) {
              setMsg(errorText(err));
            }
          }}
        >
          <Input aria-label="Display name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} required />
          <Button type="submit">Save name</Button>
        </form>
        {msg && <p role="status" className="text-muted-foreground">{msg}</p>}
        <div className="border-t border-border pt-4">
          {!confirming ? (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete my account
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <p>This removes your name, review history and board memberships. It cannot be undone.</p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  onClick={async () => {
                    await api("POST", "/api/me/delete", { confirm: "delete" });
                    await refresh();
                    navigate("/");
                  }}
                >
                  Yes, delete everything
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
