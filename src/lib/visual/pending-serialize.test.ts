import { describe, expect, it, vi } from "vitest";
import { flushPendingSerialize, setPendingSerializeFlush } from "./pending-serialize";

describe("pending-serialize registry", () => {
  it("calls the registered flush and restores the previous one", () => {
    const first = vi.fn();
    expect(setPendingSerializeFlush(first)).toBeNull();

    const second = vi.fn();
    expect(setPendingSerializeFlush(second)).toBe(first);

    flushPendingSerialize();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    // Restoring the previous handler puts it back in charge.
    expect(setPendingSerializeFlush(first)).toBe(second);
    flushPendingSerialize();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    setPendingSerializeFlush(null);
  });
});
