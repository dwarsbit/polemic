import { describe, expect, it } from "vitest";
import { formatShortcut } from "@/lib/platform";

describe("formatShortcut", () => {
  it("uses Apple's symbols and order on macOS", () => {
    expect(formatShortcut("Mod+Shift+P", true)).toBe("⇧⌘P");
    expect(formatShortcut("Mod+Alt+P", true)).toBe("⌥⌘P");
    expect(formatShortcut("Shift+Alt+F", true)).toBe("⌥⇧F");
    expect(formatShortcut("Mod+Enter", true)).toBe("⌘↩");
  });

  it("spells out modifiers elsewhere", () => {
    expect(formatShortcut("Mod+Shift+P", false)).toBe("Ctrl+Shift+P");
    expect(formatShortcut("Mod+Alt+P", false)).toBe("Ctrl+Alt+P");
    expect(formatShortcut("Shift+Alt+F", false)).toBe("Alt+Shift+F");
    expect(formatShortcut("Mod+Enter", false)).toBe("Ctrl+Enter");
  });
});
