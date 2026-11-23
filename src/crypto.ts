import { HttpError } from "./http";

const enc = new TextEncoder();

export const MIN_INVITE_KEY_LENGTH = 32;

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** URL-safe random token. 16 bytes = 128 bits, 32 bytes = 256 bits. */
export const randomToken = (bytes = 16) => b64url(randomBytes(bytes));

/** 128-bit random identifier as 32 hex characters. Never sequential. */
export const randomId = () => toHex(randomBytes(16));

export async function sha256Hex(input: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(input))));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

/** Invite token = HMAC(server secret, board_id + ":" + epoch). Computed on demand, never stored. */
export async function inviteToken(secret: string, boardId: string, epoch: number): Promise<string> {
  // Fail closed: a missing or short key would make every invite link guessable or forgeable.
  if (typeof secret !== "string" || secret.length < MIN_INVITE_KEY_LENGTH) throw new HttpError(500, "server_misconfigured");
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${boardId}:${epoch}`));
  return b64url(new Uint8Array(sig));
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}
