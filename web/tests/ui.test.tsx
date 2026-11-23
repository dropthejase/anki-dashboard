import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Member } from "../src/api";
import { Leaderboard } from "../src/components/Leaderboard";
import { applyTheme, storedTheme } from "../src/lib/theme";
import { timeAgo } from "../src/lib/utils";

const m = (over: Partial<Member>): Member => ({
  rank: 1, user_id: "u", display_name: "A", role: "member", today: 0, week: 0, last_updated: null, is_me: false, ...over,
});

describe("Leaderboard", () => {
  it("shows podium badges for the top three only, and marks the caller", () => {
    render(
      <Leaderboard
        members={[1, 2, 3, 4].map((r) => m({ rank: r, user_id: `u${r}`, display_name: `P${r}`, is_me: r === 4, today: 10 - r }))}
      />,
    );
    expect(screen.getByLabelText("1st place")).toBeInTheDocument();
    expect(screen.getByLabelText("3rd place")).toBeInTheDocument();
    expect(screen.queryByLabelText("4th place")).toBeNull();
    expect(within(screen.getAllByTestId("member-row")[3]!).getByText("(you)")).toBeInTheDocument();
  });

  it("renders hostile names as text, never as markup", () => {
    const { container } = render(<Leaderboard members={[m({ display_name: "<img src=x onerror=alert(1)>" })]} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });

  it("only shows admin actions when provided", () => {
    const { rerender } = render(<Leaderboard members={[m({})]} />);
    expect(screen.queryByText("Remove")).toBeNull();
    rerender(<Leaderboard members={[m({})]} actions={() => <button>Remove</button>} />);
    expect(screen.getByText("Remove")).toBeInTheDocument();
  });
});

describe("theme", () => {
  it("defaults to system, persists explicit choices, and clears on system", () => {
    localStorage.clear();
    expect(storedTheme()).toBe("system");
    applyTheme("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(storedTheme()).toBe("dark");
    applyTheme("light");
    expect(document.documentElement).not.toHaveClass("dark");
    applyTheme("system");
    expect(localStorage.getItem("theme")).toBeNull();
  });
});

describe("timeAgo", () => {
  it("formats recency", () => {
    const now = 1_000_000_000;
    expect(timeAgo(null, now)).toBe("never");
    expect(timeAgo(now - 30_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3 h ago");
  });
});

describe("Help page", () => {
  it("explains the phone-to-desktop sync order", async () => {
    const { Help } = await import("../src/pages/Help");
    render(<Help />);
    expect(screen.getByRole("heading", { name: "Studying on your phone?" })).toBeInTheDocument();
    const flow = screen.getByRole("list", { name: "How phone reviews reach the leaderboard" });
    expect(within(flow).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Sync your phone", "AnkiWeb", "Sync Anki on your computer", "Leaderboard updates",
    ]);
  });
});

describe("BoardStats", () => {
  it("shows the caller's rank and how far behind the member above they are", async () => {
    const { BoardStats } = await import("../src/components/BoardStats");
    render(
      <BoardStats
        total={3}
        members={[
          m({ rank: 1, user_id: "a", display_name: "Ana", today: 50 }),
          m({ rank: 2, user_id: "b", display_name: "Me", today: 30, is_me: true }),
          m({ rank: 3, user_id: "c", display_name: "Cy", today: 10 }),
        ]}
      />,
    );
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("20 cards behind Ana")).toBeInTheDocument();
  });

  it("renders nothing when the caller is not in the list", async () => {
    const { BoardStats } = await import("../src/components/BoardStats");
    const { container } = render(<BoardStats total={1} members={[m({})]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MemberMenu", () => {
  it("opens, toggles the role, and needs a confirmation to remove", async () => {
    const { MemberMenu } = await import("../src/components/MemberMenu");
    const { fireEvent } = await import("@testing-library/react");
    let role = 0;
    let removed = 0;
    render(<MemberMenu member={m({ display_name: "Bo" })} onToggleRole={() => void role++} onRemove={() => void removed++} />);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Bo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Make admin" }));
    expect(role).toBe(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Actions for Bo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from board" }));
    expect(removed).toBe(0);
    fireEvent.click(within(screen.getByRole("menu")).getByRole("button", { name: "Remove" }));
    expect(removed).toBe(1);
  });
});
