import { Check, Copy, Download, KeyRound } from "lucide-react";
import { useState } from "react";
import { Code } from "./Code";
import { Modal } from "./Modal";
import { Button } from "./ui/button";

interface Props {
  code: string | null;
  onClose: () => void;
}

export function recoveryFileText(code: string): string {
  return [
    "Anki Leaderboard recovery code",
    "",
    code,
    "",
    "Keep this file somewhere safe, such as a password manager. Anyone with this code can take over your leaderboard account.",
    "To use it, choose Tools > Leaderboard Settings > Restore with a recovery code in Anki. It works once, and then you are given a new code.",
    "",
  ].join("\n");
}

/** Shows a recovery code once. It can only be closed after the person confirms they have saved it. */
export function RecoveryCodeDialog({ code, onClose }: Props) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  function download() {
    if (!code) return;
    const url = URL.createObjectURL(new Blob([recoveryFileText(code)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "anki-leaderboard-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal open={code !== null} onClose={() => (saved ? onClose() : undefined)} labelledBy="recovery-title">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground">
            <KeyRound className="h-6 w-6" aria-hidden />
          </span>
          <h2 id="recovery-title" className="text-lg font-semibold tracking-tight">Your recovery code</h2>
          <p className="text-sm text-muted-foreground">
            Save it somewhere safe, such as a password manager. It is shown only once. Anyone who has it can take over your account.
          </p>
        </div>
        <Code data-testid="recovery-code" className="block rounded-lg px-3 py-3 text-center text-lg font-semibold tracking-wider">{code}</Code>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // clipboard blocked: the code is on screen
              }
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="outline" size="sm" onClick={download}>
            <Download className="h-3.5 w-3.5" aria-hidden /> Download .txt
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>I have saved this code somewhere safe.</span>
        </label>
        <Button disabled={!saved} onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
