import { HelpCircle, LogOut, Trophy } from "lucide-react";
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
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
            <a
              href="/"
              className="flex items-center gap-2.5 font-semibold tracking-tight"
              onClick={(e) => { e.preventDefault(); navigate("/"); }}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <Trophy className="h-4 w-4" aria-hidden />
              </span>
              <span className="hidden sm:inline">Anki Leaderboard</span>
            </a>
            <nav className="flex items-center gap-1" aria-label="Main">
              <Button variant="ghost" size="sm" onClick={() => navigate("/help")}>
                <HelpCircle className="h-4 w-4" aria-hidden /> Help
              </Button>
              <ThemeToggle />
              {me && (
                <>
                  <span className="mx-2 h-5 w-px bg-border" aria-hidden />
                  <span className="flex items-center gap-2" data-testid="whoami">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase" aria-hidden>
                      {[...me.user.display_name][0]}
                    </span>
                    <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">{me.user.display_name}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Sign out"
                    title="Sign out"
                    onClick={async () => {
                      await api("POST", "/api/logout");
                      setMe(null);
                      navigate("/");
                    }}
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                  </Button>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">{page}</main>
      </div>
    </SessionContext.Provider>
  );
}
