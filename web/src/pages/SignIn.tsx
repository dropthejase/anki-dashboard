import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useSession } from "../App";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { navigate } from "../lib/router";

type State = { kind: "checking" } | { kind: "confirm"; name: string } | { kind: "invalid" } | { kind: "working"; name: string };

export function SignIn() {
  const { refresh } = useSession();
  const [state, setState] = useState<State>({ kind: "checking" });
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // The token lives in the URL fragment so it is never sent to a server or leaked via Referer.
    // Move it into memory and clear it from the address bar and history.
    const t = location.hash.slice(1);
    history.replaceState(null, "", location.pathname);
    if (!t) return setState({ kind: "invalid" });
    setToken(t);
    api<{ display_name: string }>("POST", "/api/login-link/inspect", { token: t })
      .then((r) => setState({ kind: "confirm", name: r.display_name }))
      .catch(() => setState({ kind: "invalid" }));
  }, []);

  async function confirm(name: string) {
    setState({ kind: "working", name });
    try {
      await api("POST", "/api/login-link/consume", { token });
      await refresh();
      navigate("/");
    } catch (e) {
      setState({ kind: e instanceof ApiError ? "invalid" : "invalid" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.kind === "checking" && <p className="text-muted-foreground">Checking your link…</p>}
        {state.kind === "invalid" && (
          <p role="alert">
            This sign-in link has expired or was already used. In Anki, choose <strong>Tools → Open Leaderboard</strong> to get a new one.
          </p>
        )}
        {(state.kind === "confirm" || state.kind === "working") && (
          <>
            <p>
              Sign in as <strong data-testid="signin-name">{state.name}</strong>?
            </p>
            <p className="text-sm text-muted-foreground">Only continue if you just asked Anki to open the leaderboard.</p>
            <div>
              <Button disabled={state.kind === "working"} onClick={() => confirm(state.name)}>
                Sign in as {state.name}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
