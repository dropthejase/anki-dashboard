import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BoardPicture } from "../../web/src/components/BoardPicture";
import { baseScale, centred, clampPlacement, zoomTo, ZOOM_MAX } from "../../web/src/lib/crop";

const BOX = 240;

describe("crop geometry", () => {
  it("fits the short side to the box and centres the long side", () => {
    // A 600 by 300 picture: the short side (300) scales to 240, so the picture is 480 wide and sits 120 left of centre.
    const p = centred(600, 300, BOX);
    expect(baseScale(600, 300, BOX)).toBeCloseTo(0.8);
    expect(p.zoom).toBe(1);
    expect(p.x).toBeCloseTo(-120);
    expect(p.y).toBeCloseTo(0);
  });

  it("never lets the picture leave an empty gap inside the box", () => {
    const p = clampPlacement({ zoom: 1, x: 50, y: -999 }, 600, 300, BOX);
    expect(p.x).toBe(0); // cannot drag past the left edge
    expect(p.y).toBe(0); // there is no spare height at zoom 1
    expect(clampPlacement({ zoom: 1, x: -9999, y: 0 }, 600, 300, BOX).x).toBeCloseTo(-240);
  });

  it("limits zoom, and keeps the middle of the picture in the middle while zooming", () => {
    const start = centred(400, 400, BOX);
    const zoomed = zoomTo(start, 2, 400, 400, BOX);
    expect(zoomed.zoom).toBe(2);
    expect(zoomed.x).toBeCloseTo(-120); // 480 wide, centred in 240
    expect(zoomTo(start, 99, 400, 400, BOX).zoom).toBe(ZOOM_MAX);
    expect(zoomTo(zoomed, 1, 400, 400, BOX)).toEqual(start);
  });
});

describe("BoardPicture", () => {
  it("shows the first letter when there is no picture", () => {
    render(<BoardPicture boardId={"a".repeat(32)} name="  zebra club" version={null} />);
    expect(screen.getByText("Z")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("asks for a versioned picture, and falls back to the letter if it will not load", () => {
    const id = "b".repeat(32);
    const { container } = render(<BoardPicture boardId={id} name="Study group" version={123} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(`/api/boards/${id}/image?v=123`);
    fireEvent.error(img);
    expect(screen.getByText("S")).toBeInTheDocument();
  });
});
