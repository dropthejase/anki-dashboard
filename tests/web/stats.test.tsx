import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Member } from "../../web/src/api";
import { entryFor, StatsChart } from "../../web/src/components/StatsChart";

const member = (name: string, stats: Member["stats"], over: Partial<Member> = {}): Member => ({
  rank: 1, user_id: name, display_name: name, role: "member", today: 0, week: 0, last_updated: null, is_me: false, stats, ...over,
});
const stats = (over: Partial<NonNullable<Member["stats"]>> = {}): NonNullable<Member["stats"]> => ({
  days_studied: 10, retention_today: { passed: 40, failed: 10 }, retention_week: { passed: 90, failed: 10 }, retrievability: 0.85, ...over,
});

const names = () => screen.getAllByTestId("stat-row").map((r) => r.textContent ?? "");

describe("StatsChart", () => {
  const members = [
    member("Low", stats({ days_studied: 4 })),
    member("High", stats({ days_studied: 28 }), { is_me: true }),
    member("None", null),
  ];

  it("lists members by days studied, highest first, with a dash for a member who shares nothing", () => {
    render(<StatsChart members={members} />);
    const rows = names();
    expect(rows[0]).toContain("High");
    expect(rows[0]).toContain("28 / 30");
    expect(rows[1]).toContain("Low");
    expect(rows[2]).toContain("None");
    expect(rows[2]).toContain("—");
  });

  it("switches the statistic from the dropdown and re-sorts", () => {
    const m = [
      member("A", stats({ retention_week: { passed: 80, failed: 20 } })),
      member("B", stats({ retention_week: { passed: 95, failed: 5 } })),
    ];
    render(<StatsChart members={m} />);
    fireEvent.change(screen.getByLabelText("Statistic"), { target: { value: "week" } });
    const rows = names();
    expect(rows[0]).toContain("B");
    expect(rows[0]).toContain("95%");
    expect(rows[1]).toContain("A");
  });

  it("shows how many reviews a retention figure rests on", () => {
    render(<StatsChart members={[member("A", stats())]} />);
    fireEvent.change(screen.getByLabelText("Statistic"), { target: { value: "today" } });
    const row = screen.getByTestId("stat-row");
    expect(within(row).getByTestId("stat-value")).toHaveTextContent("80%");
    expect(within(row).getByTestId("stat-value")).toHaveTextContent("50 reviews");
  });

  it("explains when nobody has shared statistics", () => {
    render(<StatsChart members={[member("A", null)]} />);
    expect(screen.getByText(/Nobody has shared statistics yet/)).toBeInTheDocument();
  });
});

describe("entryFor", () => {
  it("scales days out of 30 and retrievability as a percentage", () => {
    expect(entryFor("days", member("A", stats({ days_studied: 15 })))).toMatchObject({ percent: 50, text: "15 / 30" });
    expect(entryFor("retrievability", member("A", stats({ retrievability: 0.874 })))).toMatchObject({ percent: 87.4, text: "87%" });
  });

  it("has no value when the statistic is missing", () => {
    expect(entryFor("retrievability", member("A", stats({ retrievability: null }))).percent).toBeNull();
    expect(entryFor("today", member("A", stats({ retention_today: null }))).percent).toBeNull();
    expect(entryFor("today", member("A", stats({ retention_today: { passed: 0, failed: 0 } }))).percent).toBeNull();
    expect(entryFor("days", member("A", null)).percent).toBeNull();
  });

  it("marks a retention figure resting on fewer than 20 reviews as unreliable", () => {
    expect(entryFor("today", member("A", stats({ retention_today: { passed: 9, failed: 1 } }))).faint).toBe(true);
    expect(entryFor("today", member("A", stats({ retention_today: { passed: 19, failed: 1 } }))).faint).toBe(false);
  });
});
