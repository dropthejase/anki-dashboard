import { ArrowLeft, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, errorText } from "../api";
import { useSession } from "../App";
import { Devices } from "../components/Devices";
import { RecoveryCodeDialog } from "../components/RecoveryCodeDialog";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { navigate } from "../lib/router";

export function Account() {
  const { me, refresh } = useSession();
  const [name, setName] = useState(me?.user.display_name ?? "");
  const [msg, setMsg] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");

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

      <Devices />

      <Card>
        <CardHeader>
          <CardTitle>Recovery code</CardTitle>
          <p className="text-sm text-muted-foreground">
            If you lose every computer on your account, for example after a wipe or a new machine, this code restores your account with its boards and roles. Using it
            signs out all the other computers. Anyone who has it can take over your account, so keep it somewhere safe.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground">
            {me?.recovery
              ? `You made a recovery code on ${new Date(me.recovery.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`
              : "You have not made a recovery code yet."}
          </p>
          {replacing && <p>Making a new code cancels the old one. Do you want to continue?</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={me?.recovery && !replacing ? "outline" : "default"}
              onClick={async () => {
                if (me?.recovery && !replacing) return setReplacing(true);
                setRecoveryError("");
                try {
                  const r = await api<{ code: string }>("POST", "/api/me/recovery-code");
                  setReplacing(false);
                  setNewCode(r.code);
                  await refresh();
                } catch (err) {
                  setRecoveryError(errorText(err));
                }
              }}
            >
              <KeyRound className="h-4 w-4" aria-hidden /> {me?.recovery ? (replacing ? "Yes, replace it" : "Replace recovery code") : "Create recovery code"}
            </Button>
            {replacing && <Button variant="ghost" onClick={() => setReplacing(false)}>Cancel</Button>}
          </div>
          {recoveryError && <p role="alert" className="text-danger">{recoveryError}</p>}
        </CardContent>
      </Card>
      <RecoveryCodeDialog code={newCode} onClose={() => setNewCode(null)} />

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
