import { useState } from "react";
import { cn } from "../lib/utils";

/** A board's round picture, or a circle with its first letter when it has none (or the picture cannot load). */
export function BoardPicture({ boardId, name, version, className }: { boardId: string; name: string; version: number | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const base = "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border bg-muted";
  if (version === null || failed) {
    const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
    return (
      <span aria-hidden className={cn(base, "text-lg font-semibold text-muted-foreground", className)}>
        {initial}
      </span>
    );
  }
  return (
    <img
      src={`/api/boards/${boardId}/image?v=${version}`}
      alt=""
      width={96}
      height={96}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(base, "object-cover", className)}
    />
  );
}
