import { Laptop, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorText, type Device } from "../api";
import { timeAgo } from "../lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

/** The computers that can send counts for this account, with a way to remove one that is lost or no longer used. */
export function Devices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices((await api<{ devices: Device[] }>("GET", "/api/devices")).devices);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your computers</CardTitle>
        <p className="text-sm text-muted-foreground">
          Each computer has its own key. To add another, choose <strong className="text-foreground">Tools → Leaderboard Settings → Show a code for my other computer</strong> in Anki. If a computer is
          lost or sold, remove it here.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p role="alert" className="text-danger">{error}</p>}
        {devices === null ? (
          !error && <p className="text-muted-foreground">Loading…</p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Computers">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex items-center gap-3">
                  <Laptop className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                  <span className="flex flex-col">
                    <span className="font-medium" data-testid="device-label">{d.label}</span>
                    <span className="text-xs text-muted-foreground">
                      Added {new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      {d.last_seen_at ? ` · last used ${timeAgo(d.last_seen_at)}` : ""}
                    </span>
                  </span>
                </span>
                {devices.length > 1 &&
                  (confirming === d.id ? (
                    <span className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Remove {d.label}?</span>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={async () => {
                          setError("");
                          try {
                            await api("DELETE", `/api/devices/${d.id}`);
                            setConfirming(null);
                            await load();
                          } catch (e) {
                            setError(errorText(e));
                          }
                        }}
                      >
                        Remove
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>Cancel</Button>
                    </span>
                  ) : (
                    <Button variant="outline" size="sm" aria-label={`Remove ${d.label}`} onClick={() => setConfirming(d.id)}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
        )}
        {devices !== null && devices.length === 1 && <p className="text-sm text-muted-foreground">This is your only computer, so it cannot be removed.</p>}
      </CardContent>
    </Card>
  );
}
