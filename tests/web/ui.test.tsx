import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    const download = screen.getByRole("link", { name: "Download the add-on" });
    expect(download).toHaveAttribute("href", expect.stringContaining("/releases/latest"));
    expect(download).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByLabelText("Server address")).toHaveTextContent(location.origin);
    expect(screen.getAllByRole("img")).toHaveLength(5);
    for (const img of screen.getAllByRole("img")) expect(img).toHaveAttribute("alt", expect.stringMatching(/\w{10,}/));
    expect(screen.getByRole("heading", { name: "Common questions" })).toBeInTheDocument();
    const contents = screen.getByRole("navigation", { name: "On this page" });
    expect(contents).toHaveTextContent("Common questions");
    for (const link of contents.querySelectorAll("a")) {
      const id = link.getAttribute("href")!.slice(1);
      expect(document.getElementById(id), `section for ${link.textContent}`).not.toBeNull();
    }
    expect(screen.queryByRole("heading", { name: "Something not working?" })).toBeNull();
    expect(screen.getByRole("heading", { name: /I do not see Open Leaderboard in the Tools menu/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Can I use more than one computer\?/ })).toBeInTheDocument();
    expect(screen.getByText(/reinstall it/)).toBeInTheDocument();
    expect(screen.getByText(/Could not reach the leaderboard/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /What is a recovery code, and how do I use one\?/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent).slice(0, 6)).toEqual([
      "Download the add-on", "Install the add-on", "Point the add-on at this site", "Open the leaderboard", "Make or join a board", "Add another computer (optional)",
    ]);
    expect(screen.getByRole("link", { name: /See the install guide/ })).toHaveAttribute("href", expect.stringContaining("docs/INSTALL.md"));
    const flow = screen.getByRole("list", { name: "How phone reviews reach the leaderboard" });
    expect(within(flow).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Sync your phone", "Sync Anki on your computer", "Leaderboard updates",
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

describe("RecoveryCodeDialog", () => {
  it("shows the code and cannot be closed until the person confirms they saved it", async () => {
    const { RecoveryCodeDialog, recoveryFileText } = await import("../../web/src/components/RecoveryCodeDialog");
    const { fireEvent } = await import("@testing-library/react");
    let closed = 0;
    const code = "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567";
    render(<RecoveryCodeDialog code={code} onClose={() => void closed++} />);
    const dialog = screen.getByRole("dialog", { name: "Your recovery code" });
    expect(within(dialog).getByTestId("recovery-code")).toHaveTextContent(code);
    const done = within(dialog).getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(closed).toBe(0); // neither Escape nor a click outside can dismiss an unsaved code
    fireEvent.click(within(dialog).getByLabelText("I have saved this code somewhere safe."));
    expect(done).toBeEnabled();
    fireEvent.click(done);
    expect(closed).toBe(1);
    expect(recoveryFileText(code)).toContain(code);
    expect(recoveryFileText(code)).toContain("Restore with a recovery code");
  });

  it("renders nothing without a code", async () => {
    const { RecoveryCodeDialog } = await import("../../web/src/components/RecoveryCodeDialog");
    render(<RecoveryCodeDialog code={null} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Devices", () => {
  const device = (over: Partial<import("../../web/src/api").Device>) => ({ id: "a".repeat(32), label: "Macbook (macOS)", created_at: 1_700_000_000_000, last_seen_at: null, ...over });

  async function renderWith(list: import("../../web/src/api").Device[]) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (init?.method === "DELETE") list = list.filter((d) => !url.endsWith(d.id));
        return new Response(JSON.stringify({ devices: list, ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    const { Devices } = await import("../../web/src/components/Devices");
    render(<Devices />);
    return calls;
  }

  it("lists the computers and lets one be removed after a confirmation", async () => {
    const { fireEvent, waitFor } = await import("@testing-library/react");
    const calls = await renderWith([device({ id: "a".repeat(32) }), device({ id: "b".repeat(32), label: "Laptop (Windows)" })]);
    expect(await screen.findByText("Laptop (Windows)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Laptop (Windows)" }));
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false); // nothing happens until it is confirmed
    fireEvent.click(within(screen.getByText(/Remove Laptop \(Windows\)\?/).parentElement!).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.some((c) => c === `DELETE /api/devices/${"b".repeat(32)}`)).toBe(true));
    await waitFor(() => expect(screen.queryByText("Laptop (Windows)")).toBeNull());
    vi.unstubAllGlobals();
  });

  it("offers no remove button when there is only one computer", async () => {
    await renderWith([device({})]);
    expect(await screen.findByText("Macbook (macOS)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.getByText(/only computer/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
