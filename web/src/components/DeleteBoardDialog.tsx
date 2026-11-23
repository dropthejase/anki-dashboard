import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { errorText } from "../api";
import { Modal } from "./Modal";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface Props {
  open: boolean;
  boardName: string;
  onClose: () => void;
  onConfirm: (typed: string) => Promise<void>;
}

export function DeleteBoardDialog({ open, boardName, onClose, onConfirm }: Props) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setTyped("");
      setError("");
      setBusy(false);
    }
  }, [open]);

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} labelledBy="delete-board-title">
      <form
        className="flex flex-col gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onConfirm(typed);
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
            <TriangleAlert className="h-6 w-6" aria-hidden />
          </span>
          <h2 id="delete-board-title" className="text-lg font-semibold tracking-tight">Delete this board?</h2>
          <p className="text-sm text-muted-foreground">
            This removes the board and its invite link for every member. Everyone keeps their account and review history. This cannot be undone.
          </p>
        </div>
        <label className="flex flex-col gap-2 text-sm">
          <span>
            Type <strong className="break-all">{boardName}</strong> to confirm
          </span>
          <Input data-autofocus value={typed} maxLength={60} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={typed !== boardName || busy}>Delete board</Button>
        </div>
      </form>
    </Modal>
  );
}
