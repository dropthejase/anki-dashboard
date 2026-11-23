import { Trophy } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError, type Me } from "./api";
import { ThemeToggle } from "./components/ThemeToggle";
import { Button } from "./components/ui/button";
import { Skeleton } from "./components/ui/skeleton";
import { navigate, usePath } from "./lib/router";
import { Board } from "./pages/Board";
import { Home } from "./pages/Home";
import { Help } from "./pages/Help";
import { Join } from "./pages/Join";
import { SignIn } from "./pages/SignIn";

interface Session {
  me: Me | null;
  refresh: () => Promise<void>;
}
const SessionContext = createContext<Session>({ me: null, refresh: async () => {} });
export const useSession = () => useContext(SessionContext);

export function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("GET", "/api/me"));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error("session check failed");
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const boardId = /^\/b\/([0-9a-f]{32})$/.exec(path)?.[1];
  let page;
  if (path === "/signin") page = <SignIn />;
  else if (path === "/help") page = <Help />;
  else if (loading) page = <Skeleton className="h-40 w-full" />;
  else if (path === "/join") page = <Join />;
  else if (boardId) page = <Board id={boardId} />;
  else page = <Home />;

  return (
    <SessionContext.Provider value={{ me, refresh }}>
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6">
        <header className="flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 font-semibold" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
            <Trophy className="h-5 w-5 text-primary" aria-hidden />
            Anki Leaderboard
          </a>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => navigate("/help")}>Help</Button>
            {me && (
              <>
                <span className="mr-2 hidden text-sm text-muted-foreground sm:inline" data-testid="whoami">
                  Signed in as <strong className="text-foreground">{me.user.display_name}</strong>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await api("POST", "/api/logout");
                    setMe(null);
                    navigate("/");
                  }}
                >
                  Sign out
                </Button>
              </>
            )}
            <ThemeToggle />
          </div>
        </header>
        <main className="flex flex-col gap-6">{page}</main>
      </div>
    </SessionContext.Provider>
  );
}
