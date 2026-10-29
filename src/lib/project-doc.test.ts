import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyFileChange,
  applyFileDelete,
  applyRename,
  applyTextDiff,
  buildProjectDoc,
  conflictPath,
  createExcluder,
  decodeText,
  diskChanges,
  type FolderEntry,
  LOCAL_ORIGIN,
  normalizePath,
  readProject,
  readSnapshot,
  relativePath,
  sha256Hex,
  textEdits,
  watchRemoteChanges,
  MAX_FILE_BYTES,
} from "./project-doc";

const encode = (text: string) => new TextEncoder().encode(text);
const text = (path: string, value: string): FolderEntry => ({
  path,
  kind: "text",
  text: value,
});
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const asset = (path: string, hash = HASH_A): FolderEntry => ({
  path,
  kind: "asset",
  hash,
  size: 3,
  type: "image/png",
});

/** The files as the disk should hold them: path → text, or `asset:<hash>`. */
function files(doc: Y.Doc): Record<string, string> {
  const view = readProject(doc);
  const out: Record<string, string> = {};
  for (const [path, file] of view.texts) out[path] = file.text;
  for (const [path, ref] of view.assets) out[path] = `asset:${ref.hash.slice(0, 4)}`;
  return out;
}

/** A second replica that received everything from `doc`. */
function replica(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc), "remote");
  return copy;
}

function sync(from: Y.Doc, to: Y.Doc) {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "remote");
}

describe("normalizePath", () => {
  it("makes project-relative paths with / separators", () => {
    expect(normalizePath("chapters\\intro.tex")).toBe("chapters/intro.tex");
    expect(normalizePath("./a//b/./c.tex/")).toBe("a/b/c.tex");
  });

  it("refuses paths that leave the project", () => {
    expect(normalizePath("../x.tex")).toBeNull();
    expect(normalizePath("a/../../x")).toBeNull();
    expect(normalizePath("/etc/passwd")).toBeNull();
    expect(normalizePath("C:\\x.tex")).toBeNull();
    expect(normalizePath("./")).toBeNull();
  });

  it("resolves paths against the project root", () => {
    expect(relativePath("/home/u/paper", "/home/u/paper/fig/a.png")).toBe("fig/a.png");
    expect(relativePath("C:\\paper\\", "C:\\paper\\main.tex")).toBe("main.tex");
    expect(relativePath("/home/u/paper", "/home/u/paper2/main.tex")).toBeNull();
  });
});

describe("excludes", () => {
  it("skips git, build output and big files", () => {
    const excluded = createExcluder();
    expect(excluded(".git/config")).toBe(true);
    expect(excluded("sub/.git/HEAD")).toBe(true);
    expect(excluded("build/main.pdf")).toBe(true);
    expect(excluded("main.aux")).toBe(true);
    expect(excluded("main.synctex.gz")).toBe(true);
    expect(excluded("ch/intro.log")).toBe(true);
    expect(excluded("main.tex", { size: MAX_FILE_BYTES + 1 })).toBe(true);
    expect(excluded("main.tex", { size: MAX_FILE_BYTES })).toBe(false);
    expect(excluded(".polemic/comments/c1.json")).toBe(false);
    expect(excluded(".gitignore")).toBe(false);
    expect(excluded("figures/plot.pdf")).toBe(false);
  });

  it("follows .gitignore rules", () => {
    const excluded = createExcluder([
      { dir: "", text: "# notes\n*.tmp\n/drafts/\ndata/**/raw.csv\n!keep.tmp\n" },
      { dir: "fig", text: "*.svg\n!logo.svg\n" },
    ]);
    expect(excluded("a.tmp")).toBe(true);
    expect(excluded("deep/b.tmp")).toBe(true);
    expect(excluded("keep.tmp")).toBe(false);
    expect(excluded("drafts/old.tex")).toBe(true);
    expect(excluded("ch/drafts/old.tex")).toBe(false);
    expect(excluded("data/raw.csv")).toBe(true);
    expect(excluded("data/2024/raw.csv")).toBe(true);
    expect(excluded("fig/plot.svg")).toBe(true);
    expect(excluded("fig/logo.svg")).toBe(false);
    expect(excluded("other/plot.svg")).toBe(false);
  });

  it("never re-includes a file inside an ignored folder", () => {
    const excluded = createExcluder([{ dir: "", text: "out/\n!out/keep.tex\n" }]);
    expect(excluded("out/keep.tex")).toBe(true);
  });
});

describe("text or binary", () => {
  it("reads UTF-8 text and keeps a byte-order mark", () => {
    expect(decodeText("main.tex", encode("Grüße"))).toBe("Grüße");
    expect(decodeText("a.tex", new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe(
      "\ufeffA",
    );
  });

  it("treats NUL bytes, invalid UTF-8 and image extensions as binary", () => {
    expect(decodeText("a.dat", new Uint8Array([0x41, 0, 0x42]))).toBeNull();
    expect(decodeText("a.txt", new Uint8Array([0xff, 0xfe, 0x41]))).toBeNull();
    expect(decodeText("a.png", encode("looks like text"))).toBeNull();
  });

  it("hashes with SHA-256 in lowercase hex", async () => {
    expect(await sha256Hex(encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("reads a folder snapshot with its own .gitignore", async () => {
    const entries = await readSnapshot([
      { path: "main.tex", bytes: encode("\\documentclass{article}") },
      { path: ".gitignore", bytes: encode("*.bak\n") },
      { path: "old.bak", bytes: encode("x") },
      { path: "main.aux", bytes: encode("x") },
      { path: ".git/HEAD", bytes: encode("ref") },
      { path: "fig\\a.png", bytes: encode("abc") },
      { path: "../outside.tex", bytes: encode("x") },
    ]);
    expect(entries).toEqual([
      { path: ".gitignore", kind: "text", text: "*.bak\n" },
      {
        path: "fig/a.png",
        kind: "asset",
        hash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        size: 3,
        type: "image/png",
      },
      { path: "main.tex", kind: "text", text: "\\documentclass{article}" },
    ]);
  });
});

describe("textEdits", () => {
  const apply = (old: string, next: string) => {
    let out = old;
    for (const edit of [...textEdits(old, next)].reverse()) {
      out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to);
    }
    return out;
  };

  it("turns the old text into the new one", () => {
    const cases: [string, string][] = [
      ["", "a\nb\n"],
      ["a\nb\n", ""],
      ["a\nb", "a\nb\n"],
      ["one\ntwo\nthree\n", "one\nTWO\nthree\nfour"],
      ["a\r\nb\r\n", "a\nb\n"],
      ["x\ny\nz\n", "z\ny\nx\n"],
      ["same", "same"],
    ];
    for (const [old, next] of cases) expect(apply(old, next)).toBe(next);
  });

  it("keeps edits small", () => {
    expect(textEdits("The cat sat.\n", "The dog sat.\n")).toEqual([
      { from: 4, to: 7, insert: "dog" },
    ]);
    const edits = textEdits("a\nkeep 1\nb\nkeep 2\nc\n", "A\nkeep 1\nb\nkeep 2\nC\n");
    expect(edits).toEqual([
      { from: 0, to: 1, insert: "A" },
      { from: 18, to: 19, insert: "C" },
    ]);
  });

  it("edits a Y.Text in place", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("t");
    ytext.insert(0, "Hello world\nsecond\n");
    applyTextDiff(ytext, "Hello there world\nsecond line\n");
    expect(ytext.toString()).toBe("Hello there world\nsecond line\n");
  });
});

describe("the project document", () => {
  it("builds from a folder snapshot", () => {
    const doc = buildProjectDoc([
      text("main.tex", "\\input{intro}"),
      text(".polemic/comments/c1.json", '{"text":"Hi"}'),
      asset("fig/a.png"),
    ]);
    expect(files(doc)).toEqual({
      "main.tex": "\\input{intro}",
      ".polemic/comments/c1.json": '{"text":"Hi"}',
      "fig/a.png": "asset:aaaa",
    });
    expect(doc.getMap("meta").get("layout")).toBe(1);
    expect(doc.getMap("texts").size).toBe(2);
    expect(doc.getMap("paths").size).toBe(2);
  });

  it("applies an outside change to one file only", () => {
    const doc = buildProjectDoc([text("a.tex", "alpha\n"), text("b.tex", "beta\n")]);
    const ids = new Map([...readProject(doc).texts].map(([p, f]) => [p, f.id]));
    const touched = new Set<string>();
    doc.getMap<Y.Text>("texts").observeDeep((events) => {
      for (const event of events) {
        for (const [id, ytext] of doc.getMap<Y.Text>("texts"))
          if (ytext === event.target) touched.add(id);
      }
    });
    applyFileChange(doc, text("a.tex", "alpha, edited\n"));
    expect(files(doc)).toEqual({ "a.tex": "alpha, edited\n", "b.tex": "beta\n" });
    expect([...touched]).toEqual([ids.get("a.tex")]);
  });

  it("merges two outside changes to the same file", () => {
    const one = buildProjectDoc([text("a.tex", "first\nmiddle\nlast\n")]);
    const two = replica(one);
    applyFileChange(one, text("a.tex", "FIRST\nmiddle\nlast\n"));
    applyFileChange(two, text("a.tex", "first\nmiddle\nLAST\n"));
    sync(one, two);
    sync(two, one);
    expect(files(one)).toEqual({ "a.tex": "FIRST\nmiddle\nLAST\n" });
    expect(files(two)).toEqual(files(one));
  });

  it("adds, deletes and swaps file kinds", () => {
    const doc = buildProjectDoc([text("a.tex", "a")]);
    applyFileChange(doc, asset("fig.png"));
    applyFileChange(doc, text("notes.txt", "n"));
    applyFileDelete(doc, "a.tex");
    applyFileChange(doc, text("fig.png", "now text"));
    applyFileChange(doc, asset("notes.txt", HASH_B));
    expect(files(doc)).toEqual({ "fig.png": "now text", "notes.txt": "asset:bbbb" });
    applyFileDelete(doc, "notes.txt");
    expect(files(doc)).toEqual({ "fig.png": "now text" });
  });

  it("renames a file and keeps its Y.Text", () => {
    const doc = buildProjectDoc([text("intro.tex", "Intro")]);
    const before = doc.getMap<Y.Text>("texts");
    const ytext = [...before.values()][0];
    const remote = replica(doc);
    // A remote edit made before the rename arrives still lands.
    applyFileChange(remote, text("intro.tex", "Intro, edited"));
    expect(applyRename(doc, "intro.tex", "ch/intro.tex")).toBe(1);
    expect([...doc.getMap<Y.Text>("texts").values()][0]).toBe(ytext);
    sync(remote, doc);
    sync(doc, remote);
    expect(files(doc)).toEqual({ "ch/intro.tex": "Intro, edited" });
    expect(files(remote)).toEqual(files(doc));
  });

  it("renames a folder, and a rename replaces what was at the target", () => {
    const doc = buildProjectDoc([
      text("ch/a.tex", "a"),
      asset("ch/fig.png"),
      text("chapter.tex", "not moved"),
      text("old.tex", "old"),
      text("new.tex", "replaced"),
    ]);
    expect(applyRename(doc, "ch", "parts")).toBe(2);
    applyRename(doc, "old.tex", "new.tex");
    expect(files(doc)).toEqual({
      "parts/a.tex": "a",
      "parts/fig.png": "asset:aaaa",
      "chapter.tex": "not moved",
      "new.tex": "old",
    });
    expect(doc.getMap("texts").size).toBe(3);
  });

  it("gives concurrent files on one path a deterministic conflict copy", () => {
    const one = buildProjectDoc([]);
    const two = replica(one);
    applyFileChange(one, text("notes.tex", "from one"));
    applyFileChange(two, text("notes.tex", "from two"));
    sync(one, two);
    sync(two, one);
    const view = files(one);
    expect(view).toEqual(files(two));
    expect(Object.keys(view)).toHaveLength(2);
    expect(Object.values(view).sort()).toEqual(["from one", "from two"]);
    const loser = Object.keys(view).find((path) => path !== "notes.tex")!;
    expect(loser).toMatch(/^notes \(conflict [0-9a-f-]{8}\)\.tex$/);
    // Deleting the conflict copy on disk removes only that file.
    applyFileDelete(one, loser);
    expect(Object.keys(files(one))).toEqual(["notes.tex"]);
  });

  it("names conflict copies next to the file", () => {
    expect(conflictPath("ch/a.tex", "1234567890")).toBe("ch/a (conflict 12345678).tex");
    expect(conflictPath("Makefile", "abcdef12")).toBe("Makefile (conflict abcdef12)");
    expect(conflictPath(".latexmkrc", "abcdef12")).toBe(
      ".latexmkrc (conflict abcdef12)",
    );
  });

  it("never exposes remote paths that leave the project or touch .git", () => {
    const doc = new Y.Doc();
    const add = (id: string, path: string) => {
      doc.getMap<Y.Text>("texts").set(id, new Y.Text("x"));
      doc.getMap<string>("paths").set(id, path);
    };
    add("1", "../evil.sh");
    add("2", ".git/hooks/post-checkout");
    add("3", "/etc/passwd");
    add("4", "a/./b.tex");
    add("5", "ok.tex");
    doc.getMap("assets").set("../x.png", { hash: HASH_A, size: 1, type: "image/png" });
    doc.getMap("assets").set("bad.png", { hash: "nothex", size: 1, type: "image/png" });
    expect(files(doc)).toEqual({ "ok.tex": "x" });
  });
});

describe("remote updates to disk", () => {
  it("lists writes, moves and deletes", () => {
    const doc = buildProjectDoc([
      text("a.tex", "a"),
      text("b.tex", "b"),
      text("c.tex", "c"),
      asset("fig.png"),
    ]);
    const before = readProject(doc);
    applyFileChange(doc, text("a.tex", "a2"));
    applyRename(doc, "b.tex", "ch/b.tex");
    applyFileDelete(doc, "c.tex");
    applyFileChange(doc, asset("fig.png", HASH_B));
    applyFileChange(doc, text("new.tex", "n"));
    expect(diskChanges(before, readProject(doc))).toEqual([
      { kind: "move", from: "b.tex", to: "ch/b.tex" },
      { kind: "write", path: "a.tex", text: "a2" },
      {
        kind: "write-asset",
        path: "fig.png",
        asset: { hash: HASH_B, size: 3, type: "image/png" },
      },
      { kind: "write", path: "new.tex", text: "n" },
      { kind: "delete", path: "c.tex" },
    ]);
  });

  it("writes a rename onto an existing path instead of moving", () => {
    const doc = buildProjectDoc([text("a.tex", "a"), text("b.tex", "b")]);
    const before = readProject(doc);
    applyRename(doc, "a.tex", "b.tex");
    expect(diskChanges(before, readProject(doc))).toEqual([
      { kind: "write", path: "b.tex", text: "a" },
      { kind: "delete", path: "a.tex" },
    ]);
  });

  it("reports remote transactions and skips local ones", () => {
    const local = buildProjectDoc([text("main.tex", "Hello\n")]);
    const remote = replica(local);
    const seen: unknown[] = [];
    const stop = watchRemoteChanges(local, (changes) => seen.push(changes));

    applyFileChange(local, text("main.tex", "Hello, local\n"));
    expect(seen).toEqual([]);

    sync(local, remote);
    applyFileChange(remote, text(".polemic/comments/r1.json", "{}"));
    applyFileChange(remote, text("main.tex", "Hello, local\nand remote\n"));
    sync(remote, local);
    expect(seen).toEqual([
      [
        { kind: "write", path: ".polemic/comments/r1.json", text: "{}" },
        { kind: "write", path: "main.tex", text: "Hello, local\nand remote\n" },
      ],
    ]);

    stop();
    applyFileDelete(remote, "main.tex");
    sync(remote, local);
    expect(seen).toHaveLength(1);
    expect(LOCAL_ORIGIN).toBeTypeOf("symbol");
  });
});
