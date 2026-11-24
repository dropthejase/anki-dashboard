import { Check, Copy } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Code } from "./Code";
import { Button } from "./ui/button";

export function InvitePanel({ joinPath }: { joinPath: string }) {
  const url = `${location.origin}${joinPath}`;
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 192 }).then(setQr, () => setQr(""));
  }, [url]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      {qr && <img src={qr} alt="QR code for the invite link" width={96} height={96} className="rounded-lg border border-border bg-white" />}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Code data-testid="invite-url" className="block truncate rounded-md px-2 py-1.5 text-xs">{url}</Code>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // clipboard may be blocked; the URL is visible to copy by hand
              }
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </div>
    </div>
  );
}
