/** Geometry for the picture cropper. The picture is drawn into a square box of `box` pixels and may be moved and zoomed,
 *  but it must always cover the whole box so no empty corner is ever saved. */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

export interface Placement {
  zoom: number;
  /** Where the picture's top-left corner sits inside the box. Never positive. */
  x: number;
  y: number;
}

/** The drawn size at zoom 1: the picture's short side exactly fits the box. */
export const baseScale = (width: number, height: number, box: number) => box / Math.min(width, height);

export function clampPlacement(p: Placement, width: number, height: number, box: number): Placement {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, p.zoom));
  const scale = baseScale(width, height, box) * zoom;
  const minX = box - width * scale;
  const minY = box - height * scale;
  return { zoom, x: Math.min(0, Math.max(minX, p.x)), y: Math.min(0, Math.max(minY, p.y)) };
}

export const centred = (width: number, height: number, box: number): Placement =>
  clampPlacement({ zoom: 1, x: (box - width * baseScale(width, height, box)) / 2, y: (box - height * baseScale(width, height, box)) / 2 }, width, height, box);

/** Changes the zoom while keeping whatever is at the middle of the box in the middle. */
export function zoomTo(p: Placement, zoom: number, width: number, height: number, box: number): Placement {
  const s0 = baseScale(width, height, box);
  const cx = (box / 2 - p.x) / (s0 * p.zoom);
  const cy = (box / 2 - p.y) / (s0 * p.zoom);
  return clampPlacement({ zoom, x: box / 2 - cx * s0 * zoom, y: box / 2 - cy * s0 * zoom }, width, height, box);
}

/** Draws the picture at the given placement into a context whose box is `box` pixels wide, scaled to `out` pixels. */
export function drawPlacement(ctx: CanvasRenderingContext2D, image: CanvasImageSource, width: number, height: number, p: Placement, box: number, out: number) {
  const k = out / box;
  const scale = baseScale(width, height, box) * p.zoom * k;
  ctx.fillStyle = "#ffffff"; // a transparent picture is saved on white, since the saved format has no transparency
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(image, p.x * k, p.y * k, width * scale, height * scale);
}
