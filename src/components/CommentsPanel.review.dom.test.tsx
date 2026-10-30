// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

let saved: Comment[] = [];

vi.mock("@/lib/query-client", () => ({ invalidateGitState: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readProjectFile: vi.fn(async () => SOURCE),
  saveComments: vi.fn(async (_dir: string, comments: Comment[]) => {
    saved = comments;
  }),
}));

import { CommentDialog } from "@/components/CommentDialog";
import { CommentsPanel } from "@/components/CommentsPanel";
import { setCommentDialogHandler, type CommentTarget } from "@/lib/editor-comments";
import type { Comment } from "@/lib/tauri";
import { useCommentsStore } from "@/store/comments";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

const SOURCE = "\\begin{document}\nHello, world.\n\\end{document}\n";

const comment = (id: string, extra: Partial<Comment> = {}): Comment => ({
  id,
  file: "main.tex",
  category: "question",
  text: `Text ${id}`,
  createdAt: 1,
  resolved: false,
  anchor: { text: "Hello, world.", line: 2 },
  ...extra,
});

let root: Root | null = null;
let dialog: CommentTarget | null = null;

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
  return host;
}

beforeEach(() => {
  saved = [];
  dialog = null;
  setCommentDialogHandler((target) => {
    dialog = target;
  });
  useProjectStore.setState({
    project: { name: "p", path: "/p" },
    files: [
      {
        name: "main.tex",
        path: "main.tex",
        isDir: false,
        size: null,
        modified: null,
        children: [],
      },
    ],
    mainFile: "main.tex",
    activeFile: "main.tex",
    buffers: {},
  });
  useEditorStore.setState({ content: SOURCE });
  useCommentsStore.setState({
    comments: [
      comment("own"),
      comment("rev", { author: { name: "Gina Guest", verified: false } }),
      comment("signed", { author: { name: "Rita Reviewer", verified: true } }),
      comment("re", {
        anchor: null,
        replyTo: "own",
        author: { name: "Gina Guest", verified: false },
      }),
      comment("lost", { anchor: null, replyTo: "deleted", text: "Parent gone" }),
    ],
    loaded: true,
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  setCommentDialogHandler(null);
  document.body.innerHTML = "";
});

describe("reviewers' comments in the Comments panel", () => {
  it("names reviewers and marks typed names", async () => {
    const host = await render(<CommentsPanel />);
    expect(host.textContent).toContain("Gina Guest (unverified)");
    expect(host.textContent).toContain("Rita Reviewer");
    expect(host.textContent).not.toContain("Rita Reviewer (unverified)");
  });

  it("shows replies under their comment, and a reply whose comment is gone on its own", async () => {
    const host = await render(<CommentsPanel />);
    const replies = [...host.querySelectorAll("[data-reply]")];
    expect(replies.map((r) => r.textContent)).toEqual([
      "Text reGina Guest (unverified)",
    ]);
    const ownCard = replies[0].parentElement!;
    expect(ownCard.textContent).toContain("Text own");
    expect(host.textContent).toContain("Parent gone");
    expect(host.querySelectorAll("[data-reply]")).toHaveLength(1);
  });

  it("replies to a comment from the panel and saves the reply with replyTo", async () => {
    const host = await render(<CommentsPanel />);
    const reply = [
      ...host.querySelectorAll<HTMLButtonElement>('button[title="Reply"]'),
    ][1];
    await act(async () => reply.click());
    expect(dialog).toEqual({
      kind: "new",
      file: "main.tex",
      anchor: null,
      replyTo: "rev",
    });
    act(() => root?.unmount());

    await render(<CommentDialog target={dialog} onClose={() => {}} />);
    expect(document.body.textContent).toContain("Reply");
    expect(document.body.textContent).toContain("Attached to: a comment");
    const area = document.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(area, "Thanks, fixed.");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Save",
    )!;
    await act(async () => save.click());
    const added = saved.find((c) => c.text === "Thanks, fixed.");
    expect(added).toMatchObject({ replyTo: "rev", file: "main.tex", anchor: null });
    expect(added?.author).toBeUndefined();
  });
});
