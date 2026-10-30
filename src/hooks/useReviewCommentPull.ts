import { useEffect } from "react";
import { publishApi, pullReviewComments } from "@/lib/share";
import { shareStatus } from "@/lib/tauri";
import { useCommentsStore } from "@/store/comments";
import { useProjectStore } from "@/store/project";

/** How often an open shared project looks for reviewers' comments. */
const EVERY_MS = 5 * 60_000;
/** Coming back to the window pulls too, at most this often. */
const MIN_GAP_MS = 60_000;

/** One pull per folder at a time. */
const running = new Map<string, Promise<number>>();

/**
 * Pulls reviewers' comments into the folder (phase 5a): returns how many
 * arrived, 0 when the folder is not shared or the server is out of reach.
 */
export function pullCommentsFor(dir: string): Promise<number> {
  const busy = running.get(dir);
  if (busy) return busy;
  const run = (async () => {
    const status = await shareStatus(dir).catch(() => null);
    if (!status?.signedIn || !status.link) return 0;
    const { added } = await pullReviewComments(publishApi(dir));
    return added.length;
  })()
    .catch(() => 0)
    .finally(() => running.delete(dir));
  running.set(dir, run);
  return run;
}

/**
 * While a shared project is open, brings in comments written on its
 * review page: on open, every few minutes, and on returning to the
 * window. New ones show in the Comments panel.
 */
export function useReviewCommentPull(): void {
  const dir = useProjectStore((s) => s.project?.path ?? null);

  useEffect(() => {
    if (!dir) return;
    let last = 0;
    const pull = () => {
      last = Date.now();
      void pullCommentsFor(dir).then((added) => {
        if (added > 0 && useProjectStore.getState().project?.path === dir) {
          void useCommentsStore.getState().load();
        }
      });
    };
    const onFocus = () => {
      if (Date.now() - last >= MIN_GAP_MS) pull();
    };
    pull();
    const timer = setInterval(pull, EVERY_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [dir]);
}
