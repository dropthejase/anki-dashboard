import { MoreHorizontal, ShieldCheck, ShieldOff, UserMinus } from "lucide-react";
import { useState } from "react";
import type { Member } from "../api";
import { cn } from "../lib/utils";
import { menuItem, PopoverMenu } from "./PopoverMenu";
import { Button } from "./ui/button";

interface Props {
  member: Member;
  onToggleRole: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}

function Items({ member, onToggleRole, onRemove, close }: Props & { close: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const isAdmin = member.role === "admin";
  if (confirming) {
    return (
      <div className="flex flex-col gap-2 p-2">
        <p className="text-sm">Remove {member.display_name}?</p>
        <div className="flex gap-2">
          <Button
            variant="danger"
            size="sm"
            className="flex-1"
            onClick={async () => {
              close();
              await onRemove();
            }}
          >
            Remove
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      <button
        role="menuitem"
        className={menuItem}
        onClick={async () => {
          close();
          await onToggleRole();
        }}
      >
        {isAdmin ? <ShieldOff className="h-4 w-4 text-muted-foreground" aria-hidden /> : <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />}
        {isAdmin ? "Remove admin rights" : "Make admin"}
      </button>
      <button role="menuitem" className={cn(menuItem, "text-danger hover:bg-danger/10 focus-visible:bg-danger/10 active:bg-danger/20")} onClick={() => setConfirming(true)}>
        <UserMinus className="h-4 w-4" aria-hidden /> Remove from board
      </button>
    </>
  );
}

/** A three-dot actions menu for one leaderboard row. */
export function MemberMenu(props: Props) {
  return (
    <PopoverMenu label={`Actions for ${props.member.display_name}`} trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />} triggerProps={{ size: "icon" }}>
      {(close) => <Items {...props} close={close} />}
    </PopoverMenu>
  );
}
