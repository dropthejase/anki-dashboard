import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Code } from "./Code";
import { Button } from "./ui/button";

/** A read-only value with a Copy button. If the clipboard is blocked the value is still visible to copy by hand. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Code aria-label={label} className="min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-sm">{value}</Code>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // clipboard blocked
          }
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
