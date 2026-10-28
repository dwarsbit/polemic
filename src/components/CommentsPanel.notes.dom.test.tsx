// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const disk: Record<string, string> = {};
let saved: unknown[] = [];

vi.mock("@/lib/query-client", () => ({ invalidateGitState: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readProjectFile: vi.fn(async (_dir: string, path: string) => disk[path]),
  writeProjectFile: vi.fn(async (_dir: string, path: string, content: string) => {
    disk[path] = content;
  }),
  saveComments: vi.fn(async (_dir: string, comments: unknown[]) => {
    saved = comments;
  }),
}));

import { CommentDialog } from "@/components/CommentDialog";
import { CommentsPanel } from "@/components/CommentsPanel";
import { applyEdits } from "@/lib/changes";
import { setApplyEditsHandler } from "@/lib/editor-edits";
import { setCommentDialogHandler, type CommentTarget } from "@/lib/editor-comments";
import { noteKey } from "@/lib/suggestion-notes";
import type { Comment } from "@/lib/tauri";
import { useCommentsStore } from "@/store/comments";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

const file = (path: string) => ({
  name: path,
  path,
  isDir: false,
  size: null,
  modified: null,
  children: [],
});

const SOURCE =
  "\\begin{document}\nThe \\replaced[id=LG, comment={Too strong?}]{confirm}{suggest} it.\n\\end{document}\n";
const KEY = noteKey("LG", "Too strong?");

const reply = (id: string, text: string, suggestion = KEY): Comment => ({
  id,
  file: "main.tex",
  category: "question",
  text,
  createdAt: 1,
  resolved: false,
  anchor: null,
  suggestion,
});

let root: Root | null = null;
let dialog: CommentTarget | null = null;

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
}

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
  });
  await settle();
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
    files: [file("main.tex")],
    mainFile: "main.tex",
    activeFile: "main.tex",
    buffers: {},
  });
  useEditorStore.setState({ content: SOURCE });
  useCommentsStore.setState({
    comments: [reply("r1", "Maybe not"), reply("r2", "Orphan", noteKey("LG", "Gone"))],
    loaded: true,
  });
  setApplyEditsHandler((edits) => {
    useEditorStore.setState({
      content: applyEdits(useEditorStore.getState().content, edits),
    });
    return true;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  setApplyEditsHandler(null);
  setCommentDialogHandler(null);
  document.body.innerHTML = "";
});

describe("suggestion notes in the Comments panel", () => {
  it("shows the note with its replies, marked as a suggestion note", async () => {
    const host = await render(<CommentsPanel />);
    const note = host.querySelector("[data-suggestion-note]")!;
    expect(note.textContent).toContain("Too strong?");
    expect(note.textContent).toContain("Suggestion note");
    expect(note.textContent).toContain("Maybe not");
    // A reply whose note is gone stays a comment of its own.
    expect(note.textContent).not.toContain("Orphan");
    expect(host.textContent).toContain("Orphan");
  });

  it("replies with the note's key", async () => {
    const host = await render(<CommentsPanel />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[title="Reply"]')!.click();
    });
    expect(dialog).toMatchObject({ kind: "new", file: "main.tex", suggestion: KEY });
  });

  it("edits the note in the markup and moves its replies along", async () => {
    const target: CommentTarget = {
      kind: "note",
      file: "main.tex",
      at: SOURCE.indexOf("\\replaced"),
      note: "Too strong?",
      author: "LG",
    };
    const host = await render(<CommentDialog target={target} onClose={() => {}} />);
    const area = document.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(area, "Fine as is");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Save",
    )!;
    await act(async () => {
      save.click();
    });
    await settle();
    expect(useEditorStore.getState().content).toContain(
      "\\replaced[id=LG, comment={Fine as is}]{confirm}{suggest}",
    );
    const moved = useCommentsStore.getState().comments.find((c) => c.id === "r1");
    expect(moved?.suggestion).toBe(noteKey("LG", "Fine as is"));
    expect(saved).toHaveLength(2);
    void host;
  });

  it("resolves the replies when the suggestion is accepted", async () => {
    await useCommentsStore.getState().resolveReplies("main.tex", [KEY]);
    const comments = useCommentsStore.getState().comments;
    expect(comments.find((c) => c.id === "r1")?.resolved).toBe(true);
    expect(comments.find((c) => c.id === "r2")?.resolved).toBe(false);
  });
});
