import { ArrowLeft, RefreshCw, Settings, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorText, type BoardView, type Member } from "../api";
import { useSession } from "../App";
import { BoardStats } from "../components/BoardStats";
import { InvitePanel } from "../components/InvitePanel";
import { DeleteBoardDialog } from "../components/DeleteBoardDialog";
import { Leaderboard, LeaderboardSkeleton } from "../components/Leaderboard";
import { MemberMenu } from "../components/MemberMenu";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { navigate } from "../lib/router";
import { localDate } from "../lib/utils";

const REFRESH_COOLDOWN_MS = 5_000;

export function Board({ id }: { id: string }) {
  const { refresh: refreshSession } = useSession();
  const [view, setView] = useState<BoardView | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [cooling, setCooling] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setView(await api<BoardView>("GET", `/api/boards/${id}?date=${localDate()}`));
      setError("");
      setCooling(true);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 401)) setMissing(true);
      else setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!showSettings) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    settingsRef.current?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [showSettings]);
  useEffect(() => {
    if (!cooling) return;
    const t = setTimeout(() => setCooling(false), REFRESH_COOLDOWN_MS);
    return () => clearTimeout(t);
  }, [cooling]);

  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (missing) {
    return (
      <Card>
        <CardHeader><CardTitle>Board not found</CardTitle></CardHeader>
        <CardContent>This board does not exist, or you are not a member. If you were invited, open the invite link again.</CardContent>
      </Card>
    );
  }

  const isAdmin = view?.role === "admin";
  const memberActions = (m: Member) =>
    isAdmin && !m.is_me ? (
      <MemberMenu
        member={m}
        onToggleRole={() => act(() => api("POST", `/api/boards/${id}/members/${m.user_id}/role`, { role: m.role === "admin" ? "member" : "admin" }))}
        onRemove={() => act(() => api("DELETE", `/api/boards/${id}/members/${m.user_id}`))}
      />
    ) : null;

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}><ArrowLeft className="h-4 w-4" aria-hidden /> All boards</Button>
      </div>
      {view && <BoardStats members={view.members} total={view.board.member_count} />}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle data-testid="board-name">{view ? view.board.name : "Loading…"}</CardTitle>
            {view && <p className="text-sm text-muted-foreground">{view.board.member_count} {view.board.member_count === 1 ? "member" : "members"} · cards reviewed</p>}
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="outline" size="sm" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>
                <Settings className="h-3.5 w-3.5" aria-hidden /> Board settings
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={loading || cooling}
              onClick={() => void load()}
              title="Refresh (limited to once every few seconds)"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
          {!view ? <LeaderboardSkeleton /> : <Leaderboard members={view.members} actions={isAdmin ? memberActions : undefined} />}
          <p className="mt-4 text-sm text-muted-foreground">
            Counts update when each member syncs Anki Desktop. Phone reviews count only if the phone and then Anki Desktop are synced the same day.
          </p>
        </CardContent>
      </Card>

      {view?.join_path && (
        <Card>
          <CardHeader><CardTitle>Invite people</CardTitle></CardHeader>
          <CardContent>
            <InvitePanel joinPath={view.join_path} />
          </CardContent>
        </Card>
      )}

      {view && isAdmin && showSettings && (
        <div ref={settingsRef} className="scroll-mt-20">
          <AdminSettings
            view={view}
            act={act}
            onDeleted={async () => {
              await refreshSession();
              navigate("/");
            }}
          />
        </div>
      )}

      {view && (
        <div>
          <ConfirmButton
            label="Leave board"
            variant="danger"
            confirmLabel={view.board.member_count === 1 ? "You are the last member, so this deletes the board. Leave?" : "Leave this board?"}
            onConfirm={async () => {
              try {
                await api("POST", `/api/boards/${id}/leave`);
                await refreshSession();
                navigate("/");
              } catch (e) {
                setError(errorText(e));
              }
            }}
          />
        </div>
      )}
    </>
  );
}

function ConfirmButton({ label, confirmLabel, onConfirm, variant = "ghost", size = "sm" }: { label: string; confirmLabel: string; onConfirm: () => void | Promise<void>; variant?: "ghost" | "outline" | "danger"; size?: "sm" | "default" }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button size={size} variant={variant} onClick={() => setAsking(true)}>{label}</Button>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-sm text-muted-foreground">{confirmLabel}</span>
      <Button size="sm" variant="danger" onClick={async () => { await onConfirm(); setAsking(false); }}>Yes</Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>No</Button>
    </span>
  );
}

function AdminSettings({ view, act, onDeleted }: { view: BoardView; act: (fn: () => Promise<unknown>) => Promise<void>; onDeleted: () => Promise<void> }) {
  const id = view.board.id;
  const [name, setName] = useState(view.board.name);
  const [cap, setCap] = useState(view.board.member_cap?.toString() ?? "");
  const [deleting, setDeleting] = useState(false);
  return (
    <Card>
      <CardHeader><CardTitle>Admin settings</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => { e.preventDefault(); void act(() => api("PATCH", `/api/boards/${id}`, { name })); }}
        >
          <Input aria-label="Board name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
          <Button type="submit" className="sm:w-44 sm:shrink-0">Rename</Button>
        </form>
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => { e.preventDefault(); void act(() => api("PATCH", `/api/boards/${id}`, { member_cap: cap === "" ? null : Number(cap) })); }}
        >
          <Input aria-label="Member limit" type="number" min={1} placeholder="No limit" value={cap} onChange={(e) => setCap(e.target.value)} />
          <Button type="submit" className="sm:w-44 sm:shrink-0">Set member limit</Button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void act(() => api("PATCH", `/api/boards/${id}`, { invite_enabled: !view.board.invite_enabled }))}>
            {view.board.invite_enabled ? "Turn invite link off" : "Turn invite link on"}
          </Button>
          <ConfirmButton
            variant="outline"
            size="default"
            label="Regenerate link"
            confirmLabel="Old links stop working. Continue?"
            onConfirm={() => act(() => api("POST", `/api/boards/${id}/invite/regenerate`))}
          />
        </div>
        {!view.board.invite_enabled && <p className="text-sm text-muted-foreground">The invite link is off. Nobody can join with it.</p>}
        <div className="border-t border-border pt-5">
          <Button variant="danger" onClick={() => setDeleting(true)}>
            <Trash2 className="h-4 w-4" aria-hidden /> Delete board
          </Button>
        </div>
        <DeleteBoardDialog
          open={deleting}
          boardName={view.board.name}
          onClose={() => setDeleting(false)}
          onConfirm={async (typed) => {
            await api("POST", `/api/boards/${id}/delete`, { confirm: typed });
            await onDeleted();
          }}
        />
      </CardContent>
    </Card>
  );
}
