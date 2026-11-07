import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { LinkSync, mergeText, type LinkApi } from "./link-sync";
import {
  buildProjectDoc,
  projectFiles,
  readProject,
  textAt,
  type FolderEntry,
} from "./project-doc";
import { fromBase64, toBase64 } from "./share";

const HASH = "c".repeat(64);

type DiskFile = string | { hash: string };

/** A folder on disk and a server document, with the LinkApi between them. */
function setup(files: Record<string, DiskFile> = {}, serverFiles: FolderEntry[] = []) {
  const disk = new Map<string, DiskFile>(Object.entries(files));
  const server = buildProjectDoc(serverFiles);
  const stored: { state: string | null; pending: string[] } = {
    state: null,
    pending: [],
  };
  const log: string[] = [];
  let offline = false;
  /** Runs once, right before the next write of that path. */
  const beforeWrite = new Map<string, () => void>();
  const failWrite = new Set<string>();
  const uploads: string[][] = [];

  const api: LinkApi = {
    load: async () => ({ ...stored }),
    save: async (state, pending) => {
      stored.state = state;
      stored.pending = pending;
    },
    folder: async () =>
      [...disk]
        .map(([path, file]): FolderEntry =>
          typeof file === "string"
            ? { path, kind: "text", text: file }
            : { path, kind: "asset", hash: file.hash, size: 3, type: "image/png" },
        )
        .filter((e) => !e.path.endsWith(".secret"))
        .sort((a, b) => a.path.localeCompare(b.path)),
    sync: async (stateVector) => {
      if (offline)
        throw { kind: "unavailable", message: "Could not reach the server." };
      return {
        update: toBase64(Y.encodeStateAsUpdate(server, fromBase64(stateVector))),
        stateVector: toBase64(Y.encodeStateVector(server)),
      };
    },
    push: async (update) => {
      if (offline)
        throw { kind: "unavailable", message: "Could not reach the server." };
      Y.applyUpdate(server, fromBase64(update));
      log.push("push");
    },
    uploadAssets: async (hashes) => {
      uploads.push(hashes);
    },
    readText: async (path) => {
      const file = disk.get(path);
      return typeof file === "string" ? file : null;
    },
    writeText: async (path, text, expected) => {
      beforeWrite.get(path)?.();
      beforeWrite.delete(path);
      if (failWrite.has(path)) throw new Error("disk full");
      const file = disk.get(path);
      const current = typeof file === "string" ? file : file ? "\0asset" : null;
      if (current !== expected) {
        if (expected === null && current === text) return true;
        return false;
      }
      disk.set(path, text);
      log.push(`write ${path}`);
      return true;
    },
    writeAsset: async (path, hash) => {
      disk.set(path, { hash });
      log.push(`asset ${path}`);
    },
    move: async (from, to) => {
      disk.set(to, disk.get(from)!);
      disk.delete(from);
      log.push(`move ${from} ${to}`);
    },
    remove: async (path) => {
      disk.delete(path);
      log.push(`remove ${path}`);
    },
  };
  return {
    api,
    disk,
    server,
    stored,
    log,
    uploads,
    beforeWrite,
    failWrite,
    setOffline: (value: boolean) => {
      offline = value;
    },
    serverText: (path: string) => textAt(server, path)?.toString(),
    /** Another client (the browser) edits the server's document. */
    edit: (path: string, change: (text: Y.Text) => void) => {
      server.transact(() => change(textAt(server, path)!));
    },
  };
}

describe("mergeText", () => {
  it("keeps edits from both sides", () => {
    expect(mergeText("a b c", "A b c", "a b C")).toBe("A b C");
    expect(mergeText("same", "same", "theirs")).toBe("theirs");
    expect(mergeText("same", "ours", "same")).toBe("ours");
  });
});

describe("LinkSync", () => {
  it("sends a folder to an empty server copy on its first sync", async () => {
    const t = setup({ "main.tex": "Hello", "fig.png": { hash: HASH } });
    const sync = new LinkSync(t.api);
    const result = await sync.run();
    expect(result).toEqual({ changed: [], pushed: true });
    expect(t.serverText("main.tex")).toBe("Hello");
    expect(projectFiles(t.server).assets.get("fig.png")?.hash).toBe(HASH);
    expect(t.uploads).toEqual([[HASH]]);
    // Nothing new: no second push.
    expect((await sync.run()).pushed).toBe(false);
  });

  it("writes the browser's edits into the folder", async () => {
    const t = setup({ "main.tex": "Hello" });
    const sync = new LinkSync(t.api);
    await sync.run();
    t.edit("main.tex", (text) => text.insert(5, " world"));
    const result = await sync.run();
    expect(result.changed).toEqual([
      { kind: "write", path: "main.tex", before: "Hello", after: "Hello world" },
    ]);
    expect(t.disk.get("main.tex")).toBe("Hello world");
    expect(result.pushed).toBe(false);
  });

  it("merges a save here with an edit in the browser", async () => {
    const t = setup({ "main.tex": "one\ntwo\nthree\n" });
    const sync = new LinkSync(t.api);
    await sync.run();
    t.edit("main.tex", (text) => text.insert(text.length, "four\n"));
    t.disk.set("main.tex", "ONE\ntwo\nthree\n");
    await sync.local({ kind: "scan" });
    expect(t.disk.get("main.tex")).toBe("ONE\ntwo\nthree\nfour\n");
    expect(t.serverText("main.tex")).toBe("ONE\ntwo\nthree\nfour\n");
  });

  it("merges a save that lands while the browser's version is written", async () => {
    const t = setup({ "main.tex": "one\ntwo\n" });
    const sync = new LinkSync(t.api);
    await sync.run();
    t.edit("main.tex", (text) => text.insert(0, "zero\n"));
    t.beforeWrite.set("main.tex", () => t.disk.set("main.tex", "one\ntwo\nthree\n"));
    const result = await sync.run();
    expect(t.disk.get("main.tex")).toBe("zero\none\ntwo\nthree\n");
    expect(t.serverText("main.tex")).toBe("zero\none\ntwo\nthree\n");
    expect(result.changed).toEqual([
      {
        kind: "write",
        path: "main.tex",
        before: "one\ntwo\nthree\n",
        after: "zero\none\ntwo\nthree\n",
      },
    ]);
  });

  it("fills an empty folder from a project opened from the account", async () => {
    const t = setup({}, [
      { path: "main.tex", kind: "text", text: "From the browser" },
      { path: "fig.png", kind: "asset", hash: HASH, size: 3, type: "image/png" },
    ]);
    t.stored.state = toBase64(Y.encodeStateAsUpdate(new Y.Doc()));
    const sync = new LinkSync(t.api);
    const result = await sync.run();
    expect(t.disk.get("main.tex")).toBe("From the browser");
    expect(t.disk.get("fig.png")).toEqual({ hash: HASH });
    expect(result.changed.map((c) => c.kind).sort()).toEqual(["asset", "write"]);
    expect(t.serverText("main.tex")).toBe("From the browser");
  });

  it("makes the folder win on the first two-way sync of a published project", async () => {
    const t = setup({ "main.tex": "Now" }, [
      { path: "main.tex", kind: "text", text: "Published" },
      { path: "old.tex", kind: "text", text: "Deleted here" },
    ]);
    const id = projectFiles(t.server).texts.get("main.tex");
    await new LinkSync(t.api).run();
    expect(t.serverText("main.tex")).toBe("Now");
    expect(t.serverText("old.tex")).toBeUndefined();
    // The same file, so comment anchors and history survive.
    expect(projectFiles(t.server).texts.get("main.tex")).toBe(id);
    expect(t.disk.has("old.tex")).toBe(false);
  });

  it("keeps a file edited here that the browser deleted", async () => {
    const t = setup({ "notes.tex": "a" });
    const sync = new LinkSync(t.api);
    await sync.run();
    t.server.transact(() => {
      const id = projectFiles(t.server).texts.get("notes.tex")!;
      t.server.getMap("texts").delete(id);
      t.server.getMap("paths").delete(id);
    });
    t.disk.set("notes.tex", "a, edited");
    await sync.run();
    expect(t.disk.get("notes.tex")).toBe("a, edited");
    expect(t.serverText("notes.tex")).toBe("a, edited");
  });

  it("deletes a file the browser deleted", async () => {
    const t = setup({ "notes.tex": "a", "main.tex": "m" });
    const sync = new LinkSync(t.api);
    await sync.run();
    t.server.transact(() => {
      const id = projectFiles(t.server).texts.get("notes.tex")!;
      t.server.getMap("texts").delete(id);
      t.server.getMap("paths").delete(id);
    });
    const result = await sync.run();
    expect(t.disk.has("notes.tex")).toBe(false);
    expect(result.changed).toEqual([{ kind: "delete", path: "notes.tex" }]);
  });

  it("keeps a renamed file's identity", async () => {
    const t = setup({ "a.tex": "text" });
    const sync = new LinkSync(t.api);
    await sync.run();
    const id = projectFiles(t.server).texts.get("a.tex");
    t.disk.set("b.tex", t.disk.get("a.tex")!);
    t.disk.delete("a.tex");
    await sync.local({ kind: "rename", from: "a.tex", to: "b.tex" });
    expect(projectFiles(t.server).texts.get("b.tex")).toBe(id);
    expect(t.serverText("a.tex")).toBeUndefined();
  });

  it("moves a file the browser renamed", async () => {
    const t = setup({ "a.tex": "text" });
    const sync = new LinkSync(t.api);
    await sync.run();
    t.server.transact(() => {
      const id = projectFiles(t.server).texts.get("a.tex")!;
      t.server.getMap("paths").set(id, "sections/a.tex");
    });
    const result = await sync.run();
    expect(result.changed).toEqual([
      { kind: "move", from: "a.tex", to: "sections/a.tex" },
    ]);
    expect(t.disk.get("sections/a.tex")).toBe("text");
  });

  it("keeps changes made offline and sends them once back", async () => {
    const t = setup({ "main.tex": "v1" });
    const sync = new LinkSync(t.api);
    await sync.run();
    t.setOffline(true);
    t.disk.set("main.tex", "v2");
    await expect(sync.local({ kind: "scan" })).rejects.toMatchObject({
      kind: "unavailable",
    });
    // The copy kept the edit, even for a new LinkSync (the app restarted).
    const later = new LinkSync(t.api);
    t.setOffline(false);
    const result = await later.run();
    expect(result.pushed).toBe(true);
    expect(t.serverText("main.tex")).toBe("v2");
  });

  it("finishes the writes an interrupted run left", async () => {
    const t = setup({ "main.tex": "one", "b.tex": "b" });
    const sync = new LinkSync(t.api);
    await sync.run();
    t.edit("main.tex", (text) => text.insert(3, " two"));
    t.edit("b.tex", (text) => text.insert(1, "!"));
    t.failWrite.add("main.tex");
    await expect(sync.run()).rejects.toThrow("main.tex");
    expect(t.stored.pending).toEqual(["main.tex"]);
    expect(t.disk.get("b.tex")).toBe("b!");
    t.failWrite.clear();
    const result = await new LinkSync(t.api).run();
    expect(t.disk.get("main.tex")).toBe("one two");
    expect(result.changed).toContainEqual({
      kind: "write",
      path: "main.tex",
      before: "one",
      after: "one two",
    });
    expect(t.stored.pending).toEqual([]);
    // The unwritten file did not read as deleted here.
    expect(t.serverText("main.tex")).toBe("one two");
  });

  it("leaves server files the folder leaves out", async () => {
    const t = setup({ "main.tex": "m", ".gitignore": "*.secret\n" });
    const sync = new LinkSync(t.api);
    await sync.run();
    t.server.transact(() => {
      t.server.getMap<Y.Text>("texts").set("x", new Y.Text("key"));
      t.server.getMap<string>("paths").set("x", "api.secret");
    });
    await sync.run();
    expect(t.disk.get("api.secret")).toBe("key");
    await sync.local({ kind: "scan" });
    expect(t.serverText("api.secret")).toBe("key");
    expect(readProject(t.server).texts.has("api.secret")).toBe(true);
  });

  it("does not push for a read-only link", async () => {
    const t = setup({ "main.tex": "here" }, [
      { path: "main.tex", kind: "text", text: "there" },
    ]);
    t.stored.state = toBase64(Y.encodeStateAsUpdate(new Y.Doc()));
    t.disk.clear();
    const sync = new LinkSync(t.api, { writable: false });
    const result = await sync.run();
    expect(result.pushed).toBe(false);
    expect(t.disk.get("main.tex")).toBe("there");
    expect(t.log).not.toContain("push");
  });
});
