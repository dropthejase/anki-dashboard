// Local development helper: plays the part of the Anki add-on so you can sign in without Anki.
// Usage: npm run dev:login -- [name] [reviews]   (needs `npm run dev` running)
import { randomBytes } from "node:crypto";

const base = process.env.LEADERBOARD_URL ?? "http://localhost:8787";
const name = process.argv[2] ?? "Dev User";
const reviews = Number(process.argv[3] ?? Math.floor(Math.random() * 200));
const secret = randomBytes(32).toString("base64url");
const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };

const post = async (path, body) => {
  const r = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} failed: ${r.status} ${await r.text()}`);
  return r.json();
};

await post("/api/register", { display_name: name });
const d = new Date();
const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Made-up Anki statistics, so the Stats tab has something to show.
const pick = (max) => Math.floor(Math.random() * (max + 1));
const today = pick(120);
const week = today + pick(600);
const stats = {
  days_studied: pick(30),
  retention_today: [Math.round(today * 0.85), today - Math.round(today * 0.85)],
  retention_week: [Math.round(week * 0.85), week - Math.round(week * 0.85)],
};
await post("/api/sync", { local_date: local, review_count: reviews, stats });
const { token } = await post("/api/login-link", {});
console.log(`${name} (${reviews} reviews today). Open within 2 minutes:\n${base}/signin#${token}`);
