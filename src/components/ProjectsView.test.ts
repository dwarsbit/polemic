import { describe, expect, it } from "vitest";
import { formatOpened } from "@/components/ProjectsView";

describe("formatOpened", () => {
  const now = new Date(2026, 10, 6, 9, 30);

  it("names today and yesterday by calendar day", () => {
    expect(formatOpened(new Date(2026, 10, 6, 0, 5).getTime(), now)).toBe("Today");
    expect(formatOpened(new Date(2026, 10, 5, 23, 50).getTime(), now)).toBe(
      "Yesterday",
    );
  });

  it("gives the date, with the year only for another year", () => {
    expect(formatOpened(new Date(2026, 9, 28).getTime(), now)).toBe("Oct 28");
    expect(formatOpened(new Date(2025, 9, 2).getTime(), now)).toBe("Oct 2, 2025");
  });
});
