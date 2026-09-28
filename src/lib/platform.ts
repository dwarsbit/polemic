/** True on macOS, where the traffic lights overlay the app content. */
export const isMac =
  typeof navigator !== "undefined" &&
  /Mac/.test(navigator.platform || navigator.userAgent);

/** Horizontal space occupied by the macOS traffic lights (titleBarStyle overlay). */
export const STOPLIGHT_WIDTH = 78;
