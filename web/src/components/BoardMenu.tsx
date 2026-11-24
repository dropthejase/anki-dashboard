import { DoorOpen, MoreHorizontal, Settings } from "lucide-react";
import { useState } from "react";
import { menuItem, PopoverMenu } from "./PopoverMenu";
import { Button } from "./ui/button";

interface Props {
  isAdmin: boolean;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onlyMember: boolean;
  onLeave: () => void | Promise<void>;
}

function Items({ isAdmin, settingsOpen, onToggleSettings, onlyMember, onLeave, close }: Props & { close: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="flex flex-col gap-2 p-2">
        <p className="text-sm">{onlyMember ? "You are the last member, so leaving deletes the board." : "Leave this board?"}</p>
        <div className="flex gap-2">
          <Button
            variant="danger"
            size="sm"
            className="flex-1"
            onClick={async () => {
              close();
              await onLeave();
            }}
          >
            Leave
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
      {isAdmin && (
        <button
          role="menuitem"
          className={menuItem}
          onClick={() => {
            close();
            onToggleSettings();
          }}
        >
          <Settings className="h-4 w-4 text-muted-foreground" aria-hidden /> {settingsOpen ? "Hide board settings" : "Board settings"}
        </button>
      )}
      <button role="menuitem" className={menuItem} onClick={() => setConfirming(true)}>
        <DoorOpen className="h-4 w-4 text-muted-foreground" aria-hidden /> Leave board
      </button>
    </>
  );
}

/** The board's overflow menu: settings for admins, and leaving. */
export function BoardMenu(props: Props) {
  return (
    <PopoverMenu label="Board options" trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />} triggerProps={{ variant: "outline", size: "icon", className: "h-8 w-8" }}>
      {(close) => <Items {...props} close={close} />}
    </PopoverMenu>
  );
}
