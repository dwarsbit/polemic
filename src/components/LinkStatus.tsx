import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useDialogsStore } from "@/store/dialogs";
import { useLinkStore, type LinkStatus } from "@/store/link";
import { useSettingsStore } from "@/store/settings";

const LABELS: Record<LinkStatus["kind"], string> = {
  syncing: "Syncing…",
  synced: "Synced",
  offline: "Offline",
  full: "Storage full",
  signedOut: "Sync paused",
  failed: "Sync failed",
};

const TITLES: Record<LinkStatus["kind"], string> = {
  syncing: "Syncing with your Polemic account",
  synced: "Saved changes sync with your Polemic account",
  offline: "Your changes stay on this computer and sync when you're back online",
  full: "Your storage is full: your changes stay on this computer",
  signedOut: "Sign in to your Polemic account to sync this project",
  failed: "This project could not sync",
};

/** Where the open project's sync stands, in the status bar; opens the Share dialog. */
export function LinkStatusIndicator() {
  const status = useLinkStore((s) => s.status);
  const setShareOpen = useDialogsStore((s) => s.setShareOpen);
  const openSettings = useSettingsStore((s) => s.openSettings);
  if (!status) return null;
  const problem = status.kind !== "syncing" && status.kind !== "synced";
  const message = "message" in status ? status.message : null;
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1.5 hover:text-foreground",
        problem && "text-warning",
      )}
      title={message && status.kind === "failed" ? message : TITLES[status.kind]}
      onClick={() =>
        status.kind === "signedOut" ? openSettings("account") : setShareOpen(true)
      }
    >
      {status.kind === "syncing" ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            problem ? "bg-warning" : "bg-success",
          )}
        />
      )}
      {LABELS[status.kind]}
    </button>
  );
}

/** Said once per project: it now syncs both ways, a drive syncs its folder too, or it has a Git remote while shared. */
export function LinkNoticeDialog() {
  const notice = useLinkStore((s) => s.notice);
  const dismiss = useLinkStore((s) => s.dismissNotice);
  return (
    <Dialog open={notice !== null} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {notice?.upgraded
              ? "This project now syncs with your browser"
              : notice?.drive
                ? "Two syncs on one folder"
                : "Git on a shared project"}
          </DialogTitle>
          <DialogDescription className="space-y-2 text-xs">
            {notice?.upgraded && (
              <span className="block">
                Changes you save here appear when you open the project in your browser,
                and changes made there arrive in this folder. Reviewers still see the
                version you publish.
              </span>
            )}
            {notice?.drive && (
              <span className="block">
                This folder is in {notice.drive}, which syncs it too. Two syncs on the
                same files can get in each other's way, so use one or the other: move
                the project out of {notice.drive}, or stop sharing it.
              </span>
            )}
            {notice?.git && (
              <span className="block">
                This folder has a Git remote, and other people work on this project too.
                Their changes already arrive here, so pulling them through Git adds
                nothing. If a Git merge leaves conflict markers, they reach everyone, so
                let one person push to the remote.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="sm" onClick={dismiss}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
