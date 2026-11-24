import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, apiBytes, errorText } from "../api";
import { centred, clampPlacement, drawPlacement, ZOOM_MAX, ZOOM_MIN, zoomTo, type Placement } from "../lib/crop";
import { BoardPicture } from "./BoardPicture";
import { Button } from "./ui/button";

const BOX = 240; // the crop window on screen, in CSS pixels
const OUT = 192; // the saved picture's width and height
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 45 * 1024; // the server accepts 48 KB
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

/** Choose a picture, move and zoom it inside a round window, then save it as the board's picture. */
export function PictureEditor({
  boardId,
  boardName,
  version,
  onChanged,
}: {
  boardId: string;
  boardName: string;
  version: number | null;
  onChanged: () => Promise<void>;
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [place, setPlace] = useState<Placement>({ zoom: 1, x: 0, y: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!bitmap || !ctx) return;
    drawPlacement(ctx, bitmap, bitmap.width, bitmap.height, place, BOX, BOX);
  }, [bitmap, place]);

  async function choose(f: File | undefined) {
    setError("");
    if (!f) return;
    if (!ACCEPTED.includes(f.type)) return setError("Choose a JPG, PNG or WebP picture.");
    if (f.size > MAX_FILE_BYTES) return setError("That file is larger than 15 MB. Choose a smaller one.");
    try {
      const b = await createImageBitmap(f);
      setBitmap(b);
      setPlace(centred(b.width, b.height, BOX));
    } catch {
      setError("That picture could not be read. Try another one.");
    }
  }

  const move = (dx: number, dy: number) =>
    bitmap && setPlace((p) => clampPlacement({ ...p, x: p.x + dx, y: p.y + dy }, bitmap.width, bitmap.height, BOX));

  async function save() {
    if (!bitmap) return;
    setBusy(true);
    setError("");
    try {
      const out = document.createElement("canvas");
      out.width = out.height = OUT;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      drawPlacement(ctx, bitmap, bitmap.width, bitmap.height, place, BOX, OUT);
      let blob = await toJpeg(out);
      for (let q = 0.7; blob && blob.size > MAX_UPLOAD_BYTES && q > 0.3; q -= 0.2) {
        blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/jpeg", q));
      }
      if (!blob || blob.size > MAX_UPLOAD_BYTES) throw new Error("too big");
      await apiBytes("PUT", `/api/boards/${boardId}/image`, blob);
      setBitmap(null);
      if (file.current) file.current.value = "";
      await onChanged();
    } catch (e) {
      setError(e instanceof Error && (e.message === "no canvas" || e.message === "too big") ? "That picture could not be prepared. Try another one." : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api("DELETE", `/api/boards/${boardId}/image`);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" aria-label="Board picture" role="group">
      <div className="flex flex-wrap items-center gap-3">
        <BoardPicture boardId={boardId} name={boardName} version={version} className="h-14 w-14" />
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Choose a picture"
          className="sr-only"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        <Button variant="outline" onClick={() => file.current?.click()} disabled={busy}>
          <ImagePlus className="h-4 w-4" aria-hidden /> {version === null ? "Add picture" : "Change picture"}
        </Button>
        {version !== null && !bitmap && (
          <Button variant="ghost" onClick={() => void remove()} disabled={busy}>
            <Trash2 className="h-4 w-4" aria-hidden /> Remove picture
          </Button>
        )}
      </div>
      {bitmap && (
        <div className="flex select-none flex-col items-start gap-3 rounded-xl bg-muted p-4">
          <p className="text-sm text-muted-foreground">Drag the picture to position it, and use the slider to zoom. Everything outside the circle is cut off.</p>
          <canvas
            ref={canvas}
            width={BOX}
            height={BOX}
            tabIndex={0}
            aria-label="Picture position. Use the arrow keys to move it."
            style={{ width: BOX, height: BOX, touchAction: "none" }}
            className="cursor-grab rounded-full border border-border bg-card"
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== e.pointerId) return;
              move(e.clientX - d.x, e.clientY - d.y);
              drag.current = { id: d.id, x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 30 : 10;
              const d: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
              const v = d[e.key];
              if (v) {
                e.preventDefault();
                move(v[0], v[1]);
              }
            }}
          />
          <label className="flex w-full max-w-60 items-center gap-2 text-sm">
            <span className="shrink-0">Zoom</span>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.01}
              value={place.zoom}
              aria-label="Zoom"
              className="w-full"
              onChange={(e) => setPlace((p) => zoomTo(p, Number(e.target.value), bitmap.width, bitmap.height, BOX))}
            />
          </label>
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={busy}>Save picture</Button>
            <Button variant="ghost" onClick={() => { setBitmap(null); setError(""); if (file.current) file.current.value = ""; }} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
