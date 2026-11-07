// Two computers and a browser on one linked project, against a real
// Polemic server. Skipped unless POLEMIC_E2E_SERVER (e.g.
// http://localhost:3000) and POLEMIC_E2E_TOKEN (a desktop token) are
// set. The server calls go over HTTP as share.rs and link.rs make them;
// each folder is kept in memory. The browser is a live sync client of
// the same document, as the browser editor is.
import { afterAll, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { LinkSync, type LinkApi } from "./link-sync";
import { textAt, type FolderEntry } from "./project-doc";
import { fromBase64, toBase64 } from "./share";

const SERVER = import.meta.env.POLEMIC_E2E_SERVER as string | undefined;
const TOKEN = import.meta.env.POLEMIC_E2E_TOKEN as string | undefined;
const json = { "content-type": "application/json" };

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...init.headers },
  });
  if (!res.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`,
    );
  }
  return res.status === 204 ? null : res.json();
}

/** A computer: a folder in memory and its LinkApi to `project`. */
function computer(project: string, files: Record<string, string> = {}, fresh = false) {
  const disk = new Map(Object.entries(files));
  const stored = {
    state: fresh
      ? toBase64(Y.encodeStateAsUpdate(new Y.Doc()))
      : (null as string | null),
    pending: [] as string[],
  };
  const api: LinkApi = {
    load: async () => ({ ...stored }),
    save: async (state, pending) => {
      Object.assign(stored, { state, pending });
    },
    folder: async () =>
      [...disk].map(([path, text]): FolderEntry => ({ path, kind: "text", text })),
    sync: (stateVector) =>
      call(`/api/projects/${project}/document/sync`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ stateVector }),
      }),
    push: async (update) => {
      await call(`/api/projects/${project}/document/update`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Blob([fromBase64(update) as Uint8Array<ArrayBuffer>]),
      });
    },
    uploadAssets: async () => {},
    readText: async (path) => disk.get(path) ?? null,
    writeText: async (path, text, expected) => {
      const current = disk.get(path) ?? null;
      if (current !== expected) return current === text && expected === null;
      disk.set(path, text);
      return true;
    },
    writeAsset: async () => {},
    move: async (from, to) => {
      disk.set(to, disk.get(from)!);
      disk.delete(from);
    },
    remove: async (path) => {
      disk.delete(path);
    },
  };
  return { disk, sync: new LinkSync(api) };
}

async function until(check: () => boolean, what: string, ms = 5_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!SERVER || !TOKEN)("linked projects against a server", () => {
  const providers: HocuspocusProvider[] = [];
  afterAll(() => providers.forEach((p) => p.destroy()));

  it("syncs two folders and the browser through the server", async () => {
    const project = await call("/api/projects", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ name: "Linked e2e", source: "linked" }),
    });
    expect(project.source).toBe("linked");

    // The laptop shares its folder.
    const laptop = computer(project.id, {
      "main.tex":
        "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
    });
    await laptop.sync.run();

    // The desktop opens it from the account: an empty folder fills in.
    const desktop = computer(project.id, {}, true);
    await desktop.sync.run();
    expect(desktop.disk.get("main.tex")).toBe(laptop.disk.get("main.tex"));

    // The browser edits the same document live.
    const doc = new Y.Doc();
    const ws = new URL("/api/sync", SERVER);
    ws.protocol = ws.protocol === "https:" ? "wss:" : "ws:";
    const browser = new HocuspocusProvider({
      url: ws.toString(),
      name: project.id,
      token: TOKEN!,
      document: doc,
    });
    providers.push(browser);
    await until(
      () => textAt(doc, "main.tex") !== null,
      "the browser to load the project",
    );
    const text = textAt(doc, "main.tex")!;
    doc.transact(() =>
      text.insert(text.toString().indexOf("Hello."), "From the browser. "),
    );

    // Meanwhile both computers save different lines.
    laptop.disk.set(
      "main.tex",
      laptop.disk.get("main.tex")!.replace("article", "report"),
    );
    desktop.disk.set("refs.bib", "@book{knuth84}\n");
    await new Promise((r) => setTimeout(r, 300));
    await laptop.sync.local({ kind: "scan" });
    await desktop.sync.local({ kind: "scan" });
    await laptop.sync.run();

    const expected =
      "\\documentclass{report}\n\\begin{document}\nFrom the browser. Hello.\n\\end{document}\n";
    expect(laptop.disk.get("main.tex")).toBe(expected);
    expect(desktop.disk.get("main.tex")).toBe(expected);
    expect(laptop.disk.get("refs.bib")).toBe("@book{knuth84}\n");
    await until(
      () => textAt(doc, "refs.bib")?.toString() === "@book{knuth84}\n",
      "the browser to get refs.bib",
    );
    expect(textAt(doc, "main.tex")!.toString()).toBe(expected);

    await call(`/api/projects/${project.id}`, { method: "DELETE" });
  });
});
