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
    expect(within(screen.getAllByTestId("member-row")[3]!).getByText("You")).toBeInTheDocument();
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
