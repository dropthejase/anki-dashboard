import { MoreHorizontal, ShieldCheck, ShieldOff, UserMinus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Member } from "../api";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

interface Props {
  member: Member;
  onToggleRole: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}

const MENU_WIDTH = 208;

const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-border/70 focus-visible:bg-border/70 active:bg-border focus-visible:outline-none";

/** A three-dot actions menu for one leaderboard row. Rendered in a portal so the table's scroll container never clips it. */
export function MemberMenu({ member, onToggleRole, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setConfirming(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const r = trigger.current!.getBoundingClientRect();
    const below = r.bottom + 6;
    const height = menu.current?.offsetHeight ?? 120;
    setPos({
      top: below + height > window.innerHeight ? Math.max(8, r.top - height - 6) : below,
      left: Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    });
    menu.current?.querySelector<HTMLElement>("button")?.focus();

    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, confirming, close]);

  const isAdmin = member.role === "admin";
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="icon"
        aria-label={`Actions for ${member.display_name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="hover:bg-border active:scale-90 aria-expanded:bg-border"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </Button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="z-50 rounded-lg border border-border bg-card p-1 shadow-lg"
          >
            {!confirming ? (
              <>
                <button
                  role="menuitem"
                  className={item}
                  onClick={async () => {
                    close();
                    await onToggleRole();
                  }}
                >
                  {isAdmin ? <ShieldOff className="h-4 w-4 text-muted-foreground" aria-hidden /> : <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />}
                  {isAdmin ? "Remove admin rights" : "Make admin"}
                </button>
                <button role="menuitem" className={cn(item, "text-danger hover:bg-danger/10 focus-visible:bg-danger/10 active:bg-danger/20")} onClick={() => setConfirming(true)}>
                  <UserMinus className="h-4 w-4" aria-hidden /> Remove from board
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-2 p-2">
                <p className="text-sm">Remove {member.display_name}?</p>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    className="flex-1"
                    onClick={async () => {
                      close();
                      await onRemove();
                    }}
                  >
                    Remove
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
