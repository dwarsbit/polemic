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
