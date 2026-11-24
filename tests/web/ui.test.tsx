import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Member } from "../../web/src/api";
import { Leaderboard } from "../../web/src/components/Leaderboard";
import { applyTheme, storedTheme } from "../../web/src/lib/theme";
import { timeAgo } from "../../web/src/lib/utils";

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
    const { Help } = await import("../../web/src/pages/Help");
    render(<Help />);
    expect(screen.getByRole("heading", { name: "Studying on your phone?" })).toBeInTheDocument();
    const download = screen.getByRole("link", { name: /Download the add-on/ });
    expect(download).toHaveAttribute("href", expect.stringContaining("/releases/latest"));
    expect(download).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByLabelText("Server address")).toHaveTextContent(location.origin);
    expect(screen.getAllByRole("img")).toHaveLength(5);
    for (const img of screen.getAllByRole("img")) expect(img).toHaveAttribute("alt", expect.stringMatching(/\w{10,}/));
    expect(screen.getByRole("heading", { name: "Something not working?" })).toBeInTheDocument();
    expect(screen.getByText(/I do not see Open Leaderboard in the Tools menu/)).toBeInTheDocument();
    expect(screen.getByText(/reinstall it/)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent).slice(0, 6)).toEqual([
      "Download the add-on", "Install the add-on", "Point the add-on at this site", "Sync Anki", "Open the leaderboard", "Make or join a board",
    ]);
    expect(screen.getByRole("link", { name: /See the install guide/ })).toHaveAttribute("href", expect.stringContaining("docs/INSTALL.md"));
    const flow = screen.getByRole("list", { name: "How phone reviews reach the leaderboard" });
    expect(within(flow).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Sync your phone", "AnkiWeb", "Sync Anki on your computer", "Leaderboard updates",
    ]);
  });
});

describe("BoardStats", () => {
  it("shows the caller's rank and how far behind the member above they are", async () => {
    const { BoardStats } = await import("../../web/src/components/BoardStats");
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
    const { BoardStats } = await import("../../web/src/components/BoardStats");
    const { container } = render(<BoardStats total={1} members={[m({})]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MemberMenu", () => {
  it("opens, toggles the role, and needs a confirmation to remove", async () => {
    const { MemberMenu } = await import("../../web/src/components/MemberMenu");
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

describe("DeleteBoardDialog", () => {
  it("only enables Delete once the exact name is typed", async () => {
    const { DeleteBoardDialog } = await import("../../web/src/components/DeleteBoardDialog");
    const { fireEvent } = await import("@testing-library/react");
    let closed = 0;
    const confirmed: string[] = [];
    render(<DeleteBoardDialog open boardName="Doomed" onClose={() => void closed++} onConfirm={async (t) => void confirmed.push(t)} />);
    const dialog = screen.getByRole("dialog", { name: "Delete this board?" });
    const button = within(dialog).getByRole("button", { name: "Delete board" });
    expect(button).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "doomed" } });
    expect(button).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Doomed" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await screen.findByRole("dialog");
    expect(confirmed).toEqual(["Doomed"]);
    expect(closed).toBe(0);
  });

  it("closes on Escape and on a backdrop click", async () => {
    const { DeleteBoardDialog } = await import("../../web/src/components/DeleteBoardDialog");
    const { fireEvent } = await import("@testing-library/react");
    let closed = 0;
    render(<DeleteBoardDialog open boardName="Doomed" onClose={() => void closed++} onConfirm={async () => {}} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closed).toBe(1);
    const backdrop = screen.getByRole("dialog").parentElement!;
    fireEvent.mouseDown(backdrop);
    expect(closed).toBe(2);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(closed).toBe(2);
  });

  it("renders nothing when closed", async () => {
    const { DeleteBoardDialog } = await import("../../web/src/components/DeleteBoardDialog");
    render(<DeleteBoardDialog open={false} boardName="X" onClose={() => {}} onConfirm={async () => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("BoardMenu", () => {
  it("shows settings only to admins and asks before leaving", async () => {
    const { BoardMenu } = await import("../../web/src/components/BoardMenu");
    const { fireEvent } = await import("@testing-library/react");
    let left = 0;
    const props = { settingsOpen: false, onToggleSettings: () => {}, onlyMember: false, onLeave: () => void left++ };
    const { unmount } = render(<BoardMenu {...props} isAdmin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Board options" }));
    expect(screen.queryByRole("menuitem", { name: "Board settings" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Leave board" }));
    expect(left).toBe(0);
    fireEvent.click(within(screen.getByRole("menu")).getByRole("button", { name: "Leave" }));
    expect(left).toBe(1);
    unmount();

    render(<BoardMenu {...props} isAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Board options" }));
    expect(screen.getByRole("menuitem", { name: "Board settings" })).toBeInTheDocument();
  });
});

describe("GithubLink", () => {
  it("links to the repository and opens safely in a new tab", async () => {
    const { GithubLink } = await import("../../web/src/components/GithubLink");
    render(<GithubLink />);
    const link = screen.getByRole("link", { name: "Source code on GitHub" });
    expect(link).toHaveAttribute("href", "https://github.com/dropthejase/anki-dashboard");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
