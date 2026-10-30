// Publish → a comment on the review page → pull, against a real Polemic
// server. Skipped unless POLEMIC_E2E_SERVER (e.g. http://localhost:3000)
// and POLEMIC_E2E_TOKEN (a desktop token) are set. The server calls go
// over HTTP as share.rs makes them; the folder is kept in memory, with
// comments written as comments.rs writes them (its tests cover the disk).
import { describe, expect, it } from "vitest";
import type { FolderEntry } from "./project-doc";
import {
  fromBase64,
  isCommentFile,
  publishForReview,
  pullReviewComments,
  type PublishApi,
} from "./share";
import type { Comment } from "./tauri";

// Vitest passes the environment on as import.meta.env.
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

const commentPath = (id: string) => `.polemic/comments/${id}.json`;

/** A PublishApi over HTTP, for a folder held in memory (path → text). */
function folderApi(folder: Map<string, string>) {
  let project = "";
  const seen = new Set<string>();
  const onDisk = () =>
    [...folder.keys()]
      .filter(isCommentFile)
      .map((path) => path.slice(".polemic/comments/".length, -".json".length));
  const api: PublishApi = {
    folder: async () =>
      [...folder].map(([path, text]): FolderEntry => ({ path, kind: "text", text })),
    create: async (name) => {
      if (project) return;
      const body = JSON.stringify({ name });
      project = (await call("/api/projects", { method: "POST", headers: json, body }))
        .id;
    },
    sync: (stateVector) =>
      call(`/api/projects/${project}/document/sync`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ stateVector }),
      }),
    commentState: async () => ({ seen: [...seen], onDisk: onDisk() }),
    saveComments: async (comments: Comment[], ids) => {
      const written = comments
        .filter((c) => !folder.has(commentPath(c.id)))
        .map((c) => {
          folder.set(commentPath(c.id), JSON.stringify(c, null, 2));
          return c.id;
        });
      for (const id of [...ids, ...written]) seen.add(id);
      return written;
    },
    uploadAssets: async () => {},
    push: async (update) => {
      await call(`/api/projects/${project}/document/update`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Blob([fromBase64(update) as Uint8Array<ArrayBuffer>]),
      });
    },
    publish: (main) =>
      call(`/api/projects/${project}/snapshots`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ main }),
      }),
  };
  return { api, project: () => project };
}

describe.skipIf(!SERVER || !TOKEN)("review comments against a server", () => {
  it("publishes, takes a comment from the review page, and pulls it into the folder", async () => {
    const folder = new Map([
      [
        "main.tex",
        "\\documentclass{article}\n\\begin{document}\nHello, world.\n\\end{document}\n",
      ],
    ]);
    const { api, project } = folderApi(folder);
    await publishForReview(api, { name: "E2E review", main: "main.tex" });

    const link = await call(`/api/projects/${project()}/links`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ role: "commenter" }),
    });
    const review = `${SERVER}/api/review/${new URL(link.url).pathname.split("/").pop()}`;
    // The review page, without an account.
    const res = await fetch(`${review}/comments`, {
      method: "POST",
      headers: { ...json, origin: new URL(SERVER!).origin },
      body: JSON.stringify({
        file: "main.tex",
        anchor: { text: "Hello, world.", line: 3 },
        text: "Which world?",
        category: "question",
        name: "Gina Guest",
      }),
    });
    expect(res.status).toBe(201);
    const posted = (await res.json()) as Comment;
    expect(posted.author).toEqual({ name: "Gina Guest", verified: false });

    const pulled = await pullReviewComments(api);
    expect(pulled.added).toEqual([posted]);
    expect(JSON.parse(folder.get(commentPath(posted.id))!)).toEqual(posted);

    // Deleted here: not pulled again, and gone from the server after a publish.
    folder.delete(commentPath(posted.id));
    expect((await pullReviewComments(api)).added).toEqual([]);
    await publishForReview(api, { name: "E2E review", main: "main.tex" });
    expect((await (await fetch(`${review}/comments`)).json()).comments).toEqual([]);
    await call(`/api/projects/${project()}`, { method: "DELETE" });
  });
});
