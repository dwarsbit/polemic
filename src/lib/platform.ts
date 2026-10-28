/** True on macOS, where the traffic lights overlay the app content. */
export const isMac =
  typeof navigator !== "undefined" &&
  /Mac/.test(navigator.platform || navigator.userAgent);

/** True on Windows. */
export const isWindows =
  typeof navigator !== "undefined" &&
  /Win/.test(navigator.platform || navigator.userAgent);

/** The primary modifier as shown in hints: "⌘" on macOS, "Ctrl+" elsewhere. */
export const modKey = isMac ? "⌘" : "Ctrl+";

/** Horizontal space occupied by the macOS traffic lights (titleBarStyle overlay). */
export const STOPLIGHT_WIDTH = 78;

/**
 * A shortcut for display, from a platform-neutral spec like
 * "Mod+Shift+P": "⇧⌘P" on macOS (symbols in Apple's order), and
 * "Ctrl+Shift+P" elsewhere. "Mod" is Cmd on macOS and Ctrl elsewhere.
 */
export function formatShortcut(spec: string, mac: boolean = isMac): string {
  const parts = spec.split("+");
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  if (mac) {
    const symbols = [
      mods.has("ctrl") ? "⌃" : "",
      mods.has("alt") ? "⌥" : "",
      mods.has("shift") ? "⇧" : "",
      mods.has("mod") ? "⌘" : "",
    ].join("");
    const macKey = key === "Enter" ? "↩" : key;
    return symbols + macKey;
  }
  const names = [
    mods.has("mod") || mods.has("ctrl") ? "Ctrl" : "",
    mods.has("alt") ? "Alt" : "",
    mods.has("shift") ? "Shift" : "",
  ].filter(Boolean);
  return [...names, key].join("+");
}
