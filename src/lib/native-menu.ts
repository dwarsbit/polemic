import { isTauri, showContextMenu } from "@/lib/tauri";

/** A native context menu entry; "separator" inserts a divider. */
export type NativeMenuEntry =
  | { id: string; text: string; action: () => void }
  | "separator";

/** Actions of the last shown menu, keyed by item id. */
let pendingActions = new Map<string, () => void>();
/** The unlisten fn of the selection listener (registered once). */
let listener: Promise<() => void> | null = null;

async function ensureListener(): Promise<void> {
  if (listener === null) {
    listener = (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<string>("menu://context", (event) => {
        pendingActions.get(event.payload)?.();
      });
    })();
    listener.catch(() => {
      // Retry on the next menu.
      listener = null;
    });
  }
  await listener;
}

/**
 * Pop up the OS-native context menu at the cursor and run the selected
 * entry's action. The menu is built on the Rust side and the selection
 * arrives as a `menu://context` event, exactly like the app menu items.
 * No-op outside the desktop app (where the in-tree hover buttons remain
 * the UI).
 */
export async function showNativeContextMenu(
  items: NativeMenuEntry[],
): Promise<void> {
  if (!isTauri()) return;
  await ensureListener();
  pendingActions = new Map(
    items.flatMap((item) =>
      item === "separator" ? [] : [[item.id, item.action] as const],
    ),
  );
  // Resolves when the menu is dismissed; the picked item (if any) is
  // dispatched through the listener above.
  await showContextMenu(
    items.map((item) =>
      item === "separator"
        ? ({ kind: "separator" } as const)
        : ({ kind: "item", id: item.id, text: item.text } as const),
    ),
  );
}
