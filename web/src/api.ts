export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: { error?: string } | null = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON error body
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "error");
  return data as T;
}

export interface BoardSummary {
  id: string;
  name: string;
  role: "admin" | "member";
  member_count: number;
}
export interface Me {
  user: { id: string; display_name: string };
  boards: BoardSummary[];
}
export interface Member {
  rank: number;
  user_id: string;
  display_name: string;
  role: "admin" | "member";
  today: number;
  week: number;
  last_updated: number | null;
  is_me: boolean;
}
export interface BoardView {
  board: { id: string; name: string; invite_enabled: boolean; member_cap: number | null; member_count: number };
  role: "admin" | "member";
  date: string;
  join_path: string | null;
  members: Member[];
}

export const errorText = (e: unknown): string => {
  if (e instanceof ApiError) {
    const map: Record<string, string> = {
      last_admin: "A board needs at least one admin. Make someone else an admin first, or delete the board.",
      confirm_mismatch: "The name you typed does not match.",
      board_full: "This board is full.",
      rate_limited: "Too many attempts. Try again later.",
      too_many_boards: "You have reached the board limit.",
      invalid_board_name: "Board names must be 1 to 60 characters, without < or >.",
      invalid_display_name: "Names must be 1 to 30 characters, without < or >.",
    };
    return map[e.code] ?? "Something went wrong. Please try again.";
  }
  return "Network error. Please try again.";
};
