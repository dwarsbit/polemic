import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readProject, type FolderEntry } from "./project-doc";
import {
  fromBase64,
  isCommentFile,
  publishForReview,
  toBase64,
  type PublishApi,
  type PublishedSnapshot,
} from "./share";

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
    setFolder: (entries: FolderEntry[]) => (folder = entries),
  };
}

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
      "folder",
      "create",
      "sync",
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
      "folder",
      "create",
      "sync",
      "upload",
      "publish",
    ]);
  });

  it("removes files gone from the folder, but keeps reviewers' comment files", async () => {
    const server = fakeServer();
    server.setFolder([
      text("main.tex", "a"),
      text("old.tex", "b"),
      asset("fig/old.png", HASH_A),
      text(".polemic/comments/mine.json", "{}"),
    ]);
    await publishForReview(server.api, { name: "Thesis", main: null });

    // A reviewer's comment arrives on the server (step 4).
    const reviewer = new Y.Doc();
    Y.applyUpdate(reviewer, Y.encodeStateAsUpdate(server.doc));
    reviewer.transact(() => {
      reviewer.getMap<Y.Text>("texts").set("rev1", new Y.Text('{"body":"Cite this"}'));
      reviewer.getMap<string>("paths").set("rev1", ".polemic/comments/rev1.json");
    });
    Y.applyUpdate(
      server.doc,
      Y.encodeStateAsUpdate(reviewer, Y.encodeStateVector(server.doc)),
    );

    server.setFolder([text("main.tex", "a"), asset("fig/new.png", HASH_B)]);
    await publishForReview(server.api, { name: "Thesis", main: null });
    expect(files(server.doc)).toEqual({
      "main.tex": "a",
      "fig/new.png": "asset:bbbb",
      ".polemic/comments/mine.json": "{}",
      ".polemic/comments/rev1.json": '{"body":"Cite this"}',
    });
    expect(server.uploaded[1]).toEqual([HASH_B]);
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
