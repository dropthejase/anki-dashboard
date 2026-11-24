import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, type ButtonProps } from "./ui/button";

interface Props {
  label: string;
  trigger: React.ReactNode;
  triggerProps?: Pick<ButtonProps, "variant" | "size" | "className">;
  width?: number;
  children: (close: () => void) => React.ReactNode;
}

export const menuItem =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-border/70 focus-visible:bg-border/70 active:bg-border focus-visible:outline-none";

/** A button that opens a small menu. Rendered in a portal so a scroll container never clips it. */
export function PopoverMenu({ label, trigger, triggerProps, width = 208, children }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const r = button.current!.getBoundingClientRect();
    const below = r.bottom + 6;
    const height = menu.current?.offsetHeight ?? 120;
    setPos({
      top: below + height > window.innerHeight ? Math.max(8, r.top - height - 6) : below,
      left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
    });
    menu.current?.querySelector<HTMLElement>("button")?.focus();

    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        button.current?.focus();
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
  }, [open, close, width]);

  return (
    <>
      <Button
        ref={button}
        variant="ghost"
        {...triggerProps}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`hover:bg-border active:scale-95 aria-expanded:bg-border ${triggerProps?.className ?? ""}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {trigger}
      </Button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width }}
            className="z-50 rounded-lg border border-border bg-card p-1 shadow-lg"
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}
