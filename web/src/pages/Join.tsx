import { useEffect, useState } from "react";
import { api, ApiError, errorText } from "../api";
import { useSession } from "../App";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { navigate } from "../lib/router";

const KEY = "pending-join";
const TTL_MS = 3_600_000;

interface Pending {
  board_id: string;
  token: string;
  at: number;
}

function readPending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as Pending | null;
    return p && Date.now() - p.at < TTL_MS ? p : null;
  } catch {
    return null;
  }
}
export const hasPendingJoin = () => readPending() !== null;
const clearPending = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
};

export function Join() {
  const { me, refresh } = useSession();
  const [invite, setInvite] = useState<Pending | null>(null);
  const [preview, setPreview] = useState<{ name: string; member_count: number; already_member: boolean } | null>(null);
  const [state, setState] = useState<"loading" | "invalid" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    // Invite links carry "<board id>.<token>" in the fragment. Keep it in memory, and remember it
    // briefly so the join can resume after the user signs in from Anki in another tab.
    const [board_id, token] = location.hash.slice(1).split(".");
    history.replaceState(null, "", location.pathname);
    let p: Pending | null = null;
    if (board_id && token) {
      p = { board_id, token, at: Date.now() };
      try {
        localStorage.setItem(KEY, JSON.stringify(p));
      } catch {
        // ignore
      }
    } else {
      p = readPending();
    }
    if (!p) return setState("invalid");
    setInvite(p);
    if (!me) return setState("ready");
    api<{ name: string; member_count: number; already_member: boolean }>("POST", "/api/join/preview", {
      board_id: p.board_id,
      token: p.token,
    })
      .then((r) => {
        setPreview(r);
        setState("ready");
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) clearPending();
        setState("invalid");
      });
  }, [me]);

  if (state === "loading") return <Card><CardContent className="p-5">Checking invite…</CardContent></Card>;
  if (state === "invalid") {
    return (
      <Card>
        <CardHeader><CardTitle>Invite not valid</CardTitle></CardHeader>
        <CardContent className="text-sm">This invite link is invalid or has been turned off. Ask a board member for a new one.</CardContent>
      </Card>
    );
  }
  if (!me) {
    return (
      <Card>
        <CardHeader><CardTitle>Sign in to join</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>You have been invited to a private leaderboard. Sign in with the Anki add-on first, then come back to this link:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Install the Anki Leaderboard add-on and sync once.</li>
            <li>Choose <strong>Tools → Open Leaderboard</strong>. This page will pick up your invite.</li>
          </ol>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle>Join “{preview?.name}”?</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>{preview?.member_count} member{preview?.member_count === 1 ? "" : "s"} can see your name and review counts.</p>
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div>
          <Button
            onClick={async () => {
              try {
                const r = await api<{ board_id: string }>("POST", "/api/join", { board_id: invite!.board_id, token: invite!.token });
                clearPending();
                await refresh();
                navigate(`/b/${r.board_id}`);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            {preview?.already_member ? "Open board" : "Join board"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
