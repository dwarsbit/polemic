import {
  Command,
  Info,
  Keyboard,
  LifeBuoy,
  Menu,
  MessageSquareWarning,
  Settings,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HELP_URL, ISSUES_URL } from "@/lib/links";
import { formatShortcut } from "@/lib/platform";
import { useDialogsStore } from "@/store/dialogs";
import { useSettingsStore } from "@/store/settings";

/** The browser build's app menu: what the desktop app keeps in its
 *  native menu bar under Polemic and Help. */
export function WebAppMenu() {
  const dialogs = () => useDialogsStore.getState();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Menu" aria-label="Menu">
          <Menu />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem onSelect={() => dialogs().setPaletteOpen(true)}>
          <Command />
          Command palette
          <DropdownMenuShortcut>{formatShortcut("Mod+P")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => useSettingsStore.getState().setSettingsDialogOpen(true)}
        >
          <Settings />
          Settings…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void openUrl(HELP_URL)}>
          <LifeBuoy />
          Polemic help
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => dialogs().setShortcutsOpen(true)}>
          <Keyboard />
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void openUrl(ISSUES_URL)}>
          <MessageSquareWarning />
          Report an issue…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => dialogs().setAboutOpen(true)}>
          <Info />
          About Polemic
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
