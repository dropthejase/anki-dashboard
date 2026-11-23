import { ArrowLeft, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, errorText } from "../api";
import { useSession } from "../App";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { navigate } from "../lib/router";

export function Account() {
  const { me, refresh } = useSession();
  const [name, setName] = useState(me?.user.display_name ?? "");
  const [msg, setMsg] = useState("");
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}><ArrowLeft className="h-4 w-4" aria-hidden /> All boards</Button>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>

      <Card>
        <CardHeader>
          <CardTitle>Display name</CardTitle>
          <p className="text-sm text-muted-foreground">Other members of your boards see this name.</p>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("PATCH", "/api/me", { display_name: name });
                await refresh();
                setMsg("Saved.");
              } catch (err) {
                setMsg(errorText(err));
              }
            }}
          >
            <Input aria-label="Display name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} required />
            <Button type="submit" className="sm:w-28 sm:shrink-0">Save</Button>
          </form>
          {msg && <p role="status" className="mt-2 text-muted-foreground">{msg}</p>}
        </CardContent>
      </Card>

      <Card className="border-danger/40">
        <CardHeader>
          <CardTitle className="text-danger">Danger zone</CardTitle>
          <p className="text-sm text-muted-foreground">Deleting your account removes your name, review history and board memberships. It cannot be undone.</p>
        </CardHeader>
        <CardContent>
          {!confirming ? (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete my account
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <p>Are you sure? This cannot be undone.</p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  onClick={async () => {
                    await api("POST", "/api/me/delete", { confirm: "delete" });
                    await refresh();
                    navigate("/");
                  }}
                >
                  Yes, delete everything
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
