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

/** Sends raw bytes (a picture). The Worker checks the type and size again. */
export async function apiBytes(method: string, path: string, body: Blob): Promise<void> {
  const res = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": body.type }, body });
  if (!res.ok) {
    let code = "error";
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, code);
  }
}

export interface BoardSummary {
  id: string;
  name: string;
  role: "admin" | "member";
  member_count: number;
  image_version: number | null;
}
export interface Me {
  user: { id: string; display_name: string };
  recovery: { created_at: number } | null;
  boards: BoardSummary[];
}
export interface Device {
  id: string;
  label: string;
  created_at: number;
  last_seen_at: number | null;
}
export interface MemberStats {
  days_studied: number;
  retention_today: { passed: number; failed: number } | null;
  retention_week: { passed: number; failed: number };
  retrievability: number | null;
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
  stats: MemberStats | null;
}
export interface BoardView {
  board: { id: string; name: string; image_version: number | null; invite_enabled: boolean; member_cap: number | null;
    max_members: number; member_count: number };
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
      last_device: "This is your only computer, so it cannot be removed.",
      board_full: "This board is full.",
      invalid_member_cap: "The member limit must be a whole number of at least 1, and no higher than the maximum shown.",
      rate_limited: "Too many attempts. Try again later.",
      too_many_boards: "You have reached the board limit.",
      invalid_board_name: "Board names must be 1 to 60 characters, without < or >.",
      invalid_image: "That does not look like a valid picture. Try another one.",
      body_too_large: "That picture is too large. Try a smaller one.",
      invalid_display_name: "Names must be 1 to 30 characters, without < or >.",
    };
    return map[e.code] ?? "Something went wrong. Please try again.";
  }
  return "Network error. Please try again.";
};
