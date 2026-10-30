import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readProject, type FolderEntry } from "./project-doc";
import {
  fromBase64,
  isCommentFile,
  parseComment,
  publishForReview,
  pullReviewComments,
  toBase64,
  type PublishApi,
  type PublishedSnapshot,
} from "./share";
import type { Comment } from "./tauri";

const text = (path: string, value: string): FolderEntry => ({
  path,
  kind: "text",
  text: value,
});
const asset = (path: string, hash: string): FolderEntry => ({
  path,
  kind: "asset",
  hash,
  size: 3,
  type: "image/png",
});
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/** The server side of the document routes, over a real Y.Doc. */
function fakeServer() {
  const doc = new Y.Doc();
  const calls: string[] = [];
  const pushed: Uint8Array[] = [];
  const uploaded: string[][] = [];
  let folder: FolderEntry[] = [];
  let created = 0;
  const seen = new Set<string>();
  const commentIds = () =>
    folder
      .filter((entry) => isCommentFile(entry.path))
      .map((entry) => entry.path.slice(".polemic/comments/".length, -".json".length));
  const api: PublishApi = {
    folder: async () => {
      calls.push("folder");
      return folder;
    },
    create: async () => {
      calls.push("create");
      created++;
    },
    sync: async (stateVector) => {
      calls.push("sync");
      return {
        update: toBase64(Y.encodeStateAsUpdate(doc, fromBase64(stateVector))),
        stateVector: toBase64(Y.encodeStateVector(doc)),
      };
    },
    commentState: async () => {
      calls.push("state");
      return { seen: [...seen], onDisk: commentIds() };
    },
    saveComments: async (comments, ids) => {
      calls.push("save");
      const written = comments
        .filter((c) => !commentIds().includes(c.id))
        .map((c) => {
          folder = [
            ...folder,
            text(`.polemic/comments/${c.id}.json`, JSON.stringify(c, null, 2)),
          ];
          return c.id;
        });
      for (const id of [...ids, ...written]) seen.add(id);
      return written;
    },
    uploadAssets: async (hashes) => {
      calls.push("upload");
      uploaded.push([...hashes].sort());
    },
    push: async (update) => {
      calls.push("push");
      const bytes = fromBase64(update);
      pushed.push(bytes);
      Y.applyUpdate(doc, bytes);
    },
    publish: async (main): Promise<PublishedSnapshot> => {
      calls.push("publish");
      return {
        id: "s",
        main,
        pdf: null,
        synctex: null,
        size: 0,
        createdAt: "2026-10-30T00:00:00.000Z",
      };
    },
  };
  return {
    api,
    doc,
    calls,
    pushed,
    uploaded,
    created: () => created,
    seen,
    folder: () => folder,
    setFolder: (entries: FolderEntry[]) => (folder = entries),
    /** A comment written on the review page: a new comment file in the document. */
    review(comment: Comment) {
      const page = new Y.Doc();
      Y.applyUpdate(page, Y.encodeStateAsUpdate(doc));
      page.transact(() => {
        const id = crypto.randomUUID();
        page
          .getMap<Y.Text>("texts")
          .set(id, new Y.Text(JSON.stringify(comment, null, 2)));
        page.getMap<string>("paths").set(id, `.polemic/comments/${comment.id}.json`);
      });
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(page, Y.encodeStateVector(doc)));
    },
  };
}

const reviewComment = (id: string, extra: Partial<Comment> = {}): Comment => ({
  id,
  file: "main.tex",
  category: "question",
  text: `Comment ${id}`,
  createdAt: 5,
  resolved: false,
  anchor: { text: "a", line: 1 },
  author: { name: "Gina Guest", verified: false },
  ...extra,
});
const ownCommentText = (id: string) =>
  JSON.stringify({ ...reviewComment(id), author: undefined });
const ownComment = (id: string) =>
  text(`.polemic/comments/${id}.json`, ownCommentText(id));

/** The server's document as files: path → text, or asset:<hash prefix>. */
function files(doc: Y.Doc): Record<string, string> {
  const view = readProject(doc);
  const out: Record<string, string> = {};
  for (const [path, file] of view.texts) out[path] = file.text;
  for (const [path, ref] of view.assets) out[path] = `asset:${ref.hash.slice(0, 4)}`;
  return out;
}

describe("publish for review", () => {
  it("sends the folder, assets before the document, then publishes", async () => {
    const server = fakeServer();
    server.setFolder([
      text("main.tex", "\\documentclass{article}"),
      asset("fig/a.png", HASH_A),
    ]);
    const steps: string[] = [];
    const snapshot = await publishForReview(
      server.api,
      { name: "Thesis", main: "main.tex" },
      (s) => steps.push(s),
    );
    expect(snapshot.main).toBe("main.tex");
    expect(server.calls).toEqual([
      "create",
      "sync",
      "state",
      "save",
      "folder",
      "upload",
      "push",
      "publish",
    ]);
    expect(steps).toEqual(["reading", "uploading", "publishing"]);
    expect(server.uploaded).toEqual([[HASH_A]]);
    expect(files(server.doc)).toEqual({
      "main.tex": "\\documentclass{article}",
      "fig/a.png": "asset:aaaa",
    });
    expect(server.doc.getMap("meta").get("layout")).toBe(1);
  });

  it("sends only what changed, and keeps file ids so nothing is duplicated", async () => {
    const server = fakeServer();
    const body = "\\section{Intro}\n" + "Words. ".repeat(500);
    server.setFolder([text("main.tex", body)]);
    await publishForReview(server.api, { name: "Thesis", main: null });
    const idBefore = [...server.doc.getMap<string>("paths").keys()];

    server.setFolder([text("main.tex", body + "One more.")]);
    await publishForReview(server.api, { name: "Thesis", main: null });
    expect([...server.doc.getMap<string>("paths").keys()]).toEqual(idBefore);
    expect(files(server.doc)["main.tex"]).toBe(body + "One more.");
    expect(server.pushed[1].length).toBeLessThan(server.pushed[0].length / 10);

    // Nothing changed: no update at all, still a new snapshot.
    const calls = server.calls.length;
    await publishForReview(server.api, { name: "Thesis", main: null });
    expect(server.calls.slice(calls)).toEqual([
      "create",
      "sync",
      "state",
      "save",
      "folder",
      "upload",
      "publish",
    ]);
  });

  it("removes files gone from the folder, and pulls reviewers' comments in first", async () => {
    const server = fakeServer();
    server.setFolder([
      text("main.tex", "a"),
      text("old.tex", "b"),
      asset("fig/old.png", HASH_A),
      ownComment("mine"),
    ]);
    await publishForReview(server.api, { name: "Thesis", main: null });
    server.review(reviewComment("rev1"));

    server.setFolder([
      text("main.tex", "a"),
      asset("fig/new.png", HASH_B),
      ownComment("mine"),
    ]);
    await publishForReview(server.api, { name: "Thesis", main: null });
    const pulled = JSON.stringify(reviewComment("rev1"), null, 2);
    expect(files(server.doc)).toEqual({
      "main.tex": "a",
      "fig/new.png": "asset:bbbb",
      ".polemic/comments/mine.json": ownCommentText("mine"),
      ".polemic/comments/rev1.json": pulled,
    });
    expect(
      server.folder().find((e) => e.path === ".polemic/comments/rev1.json"),
    ).toEqual(text(".polemic/comments/rev1.json", pulled));
    expect(server.uploaded[1]).toEqual([HASH_B]);
    expect([...server.seen].sort()).toEqual(["mine", "rev1"]);
  });

  it("stops before touching the server document when an upload fails", async () => {
    const server = fakeServer();
    server.setFolder([text("main.tex", "a"), asset("fig/a.png", HASH_A)]);
    server.api.uploadAssets = async () => {
      throw new Error("quota_exceeded");
    };
    await expect(
      publishForReview(server.api, { name: "Thesis", main: null }),
    ).rejects.toThrow("quota_exceeded");
    expect(server.pushed).toEqual([]);
    expect(server.calls).not.toContain("publish");
  });

  it("knows comment files and round-trips base64", () => {
    expect(isCommentFile(".polemic/comments/abc.json")).toBe(true);
    expect(isCommentFile(".polemic/comments/sub/abc.json")).toBe(false);
    expect(isCommentFile(".polemic/project.json")).toBe(false);
    expect(isCommentFile("x/.polemic/comments/abc.json")).toBe(false);
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(toBase64(new Uint8Array([0, 0]))).toBe("AAA=");
  });
});

describe("pulling reviewers' comments", () => {
  async function published() {
    const server = fakeServer();
    server.setFolder([text("main.tex", "a"), ownComment("mine")]);
    await publishForReview(server.api, { name: "Thesis", main: null });
    return server;
  }

  it("writes a reviewer's comment into the folder once", async () => {
    const server = await published();
    server.review(reviewComment("r1", { replyTo: "mine" }));
    const first = await pullReviewComments(server.api);
    expect(first.added).toEqual([reviewComment("r1", { replyTo: "mine" })]);
    expect(first.seen).toEqual(new Set(["mine", "r1"]));
    const again = await pullReviewComments(server.api);
    expect(again.added).toEqual([]);
    expect(server.folder().filter((e) => isCommentFile(e.path))).toHaveLength(2);
  });

  it("never overwrites the folder's copy", async () => {
    const server = await published();
    server.review(reviewComment("r1"));
    await pullReviewComments(server.api);
    // The owner resolves it here; a pull keeps that.
    const resolved = text(
      ".polemic/comments/r1.json",
      JSON.stringify({ ...reviewComment("r1"), resolved: true }, null, 2),
    );
    server.setFolder([
      ...server.folder().filter((e) => !e.path.endsWith("r1.json")),
      resolved,
    ]);
    await pullReviewComments(server.api);
    expect(server.folder().find((e) => e.path.endsWith("r1.json"))).toEqual(resolved);
    // The next publish sends the resolved copy.
    await publishForReview(server.api, { name: "Thesis", main: null });
    expect(JSON.parse(files(server.doc)[".polemic/comments/r1.json"]).resolved).toBe(
      true,
    );
  });

  it("does not bring back a comment deleted here, and the next publish removes it", async () => {
    const server = await published();
    server.review(reviewComment("r1"));
    await pullReviewComments(server.api);
    server.setFolder(server.folder().filter((e) => !e.path.endsWith("r1.json")));
    expect((await pullReviewComments(server.api)).added).toEqual([]);
    await publishForReview(server.api, { name: "Thesis", main: null });
    expect(Object.keys(files(server.doc))).toEqual([
      "main.tex",
      ".polemic/comments/mine.json",
    ]);
  });

  it("counts a reviewer's comment that reached the folder another way as held", async () => {
    const server = await published();
    server.review(reviewComment("r1"));
    // A git pull brought it in before this folder pulled from the server.
    const viaGit = text(
      ".polemic/comments/r1.json",
      JSON.stringify(reviewComment("r1"), null, 2),
    );
    server.setFolder([...server.folder(), viaGit]);
    expect((await pullReviewComments(server.api)).added).toEqual([]);
    server.setFolder(server.folder().filter((e) => e !== viaGit));
    expect((await pullReviewComments(server.api)).added).toEqual([]);
  });

  it("removes the folder's own comments deleted here, never pulling them back", async () => {
    const server = await published();
    server.seen.clear(); // A link from before this step remembers none.
    server.setFolder([text("main.tex", "a")]);
    expect((await pullReviewComments(server.api)).added).toEqual([]);
    await publishForReview(server.api, { name: "Thesis", main: null });
    expect(Object.keys(files(server.doc))).toEqual(["main.tex"]);
  });

  it("keeps a reviewer's comment that arrives during a publish", async () => {
    const server = await published();
    const folder = server.api.folder;
    server.api.folder = async () => {
      server.review(reviewComment("late"));
      return folder();
    };
    await publishForReview(server.api, { name: "Thesis", main: null });
    expect(files(server.doc)).toHaveProperty([".polemic/comments/late.json"]);
    server.api.folder = folder;
    expect((await pullReviewComments(server.api)).added.map((c) => c.id)).toEqual([
      "late",
    ]);
  });

  it("skips files that are not a reviewer's comment", async () => {
    const server = await published();
    server.review({ ...reviewComment("bad"), createdAt: -1 });
    server.review({ ...reviewComment("own"), author: undefined });
    expect((await pullReviewComments(server.api)).added).toEqual([]);
  });
});

describe("parseComment", () => {
  const json = (value: unknown) => JSON.stringify(value);
  it("reads the editor's and the review page's comments", () => {
    expect(parseComment(json(reviewComment("a")), "a")).toEqual(reviewComment("a"));
    const own = {
      ...reviewComment("a"),
      author: undefined,
      suggestion: null,
      anchor: null,
    };
    expect(parseComment(json(own), "a")).toEqual(JSON.parse(json(own)));
  });

  it("refuses anything else", () => {
    expect(parseComment("{", "a")).toBeNull();
    expect(parseComment(json(reviewComment("a")), "b")).toBeNull();
    expect(parseComment(json(reviewComment("../a")), "../a")).toBeNull();
    for (const bad of [
      { text: 1 },
      { createdAt: 1.5 },
      { anchor: { text: "a", line: 0 } },
      { author: { name: "x" } },
      { replyTo: "a/b" },
      { resolved: "no" },
    ]) {
      expect(parseComment(json({ ...reviewComment("a"), ...bad }), "a")).toBeNull();
    }
  });
});
