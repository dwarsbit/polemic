import { beforeEach, describe, expect, it } from "vitest";
import { ask, open, save } from "@/web/dialog";
import { useConfirmStore } from "@/store/confirm";

beforeEach(() => useConfirmStore.setState({ current: null }));

describe("web dialogs", () => {
  it("asks through the confirm dialog", async () => {
    const answer = ask("Delete main.tex?", { title: "Delete", okLabel: "Delete" });
    expect(useConfirmStore.getState().current).toMatchObject({
      message: "Delete main.tex?",
      title: "Delete",
      okLabel: "Delete",
    });
    useConfirmStore.getState().answer(true);
    expect(await answer).toBe(true);
    expect(useConfirmStore.getState().current).toBeNull();
  });

  it("takes a title as the second argument", async () => {
    const answer = ask("Sure?", "Check");
    expect(useConfirmStore.getState().current?.title).toBe("Check");
    useConfirmStore.getState().answer(false);
    expect(await answer).toBe(false);
  });

  it("cancels an open question when a new one comes", async () => {
    const first = ask("First?");
    const second = ask("Second?");
    expect(await first).toBe(false);
    expect(useConfirmStore.getState().current?.message).toBe("Second?");
    useConfirmStore.getState().answer(true);
    expect(await second).toBe(true);
  });

  it("has no file pickers", async () => {
    expect(await open()).toBeNull();
    expect(await save()).toBeNull();
  });
});
