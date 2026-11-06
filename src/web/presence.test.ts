import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyFileChange } from "@/lib/project-doc";
import type { OpenProject } from "@/web/projects";
import { colorFor, peersOf } from "@/web/presence";

type Awareness = Parameters<typeof peersOf>[1];

/** An awareness with these states; this tab is client 1. */
const awareness = (states: [number, Record<string, unknown>][]) =>
  ({ clientID: 1, getStates: () => new Map(states) }) as unknown as Awareness;

describe("peersOf", () => {
  const doc = new Y.Doc();
  applyFileChange(doc, { path: "main.tex", kind: "text", text: "Hello world." });
  const open = { doc } as OpenProject;
  const position = (index: number) => {
    const files = doc.getMap<Y.Text>("texts");
    const ytext = [...files.values()][0];
    return Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(ytext, index),
    );
  };

  it("lists others with their file and cursor, not this tab or this account", () => {
    const peers = peersOf(
      open,
      awareness([
        [1, { file: "main.tex" }],
        [
          2,
          {
            user: { id: "u2", name: "Bo" },
            file: "main.tex",
            cursor: { anchor: position(0), head: position(5) },
          },
        ],
        [3, { user: { id: "me", name: "Me" }, file: "main.tex" }],
        [4, { user: { id: "u4", name: "Ada" }, file: null }],
      ]),
      "me",
    );
    expect(peers.map((peer) => peer.name)).toEqual(["Ada", "Bo"]);
    const bo = peers[1];
    expect(bo.selection).toEqual({ anchor: 0, head: 5 });
    expect(bo.text).toBe("Hello world.");
    expect(bo.color).toBe(colorFor("u2"));
    expect(peers[0]).toMatchObject({ file: null, selection: null });
  });

  it("follows the text as it changes", () => {
    const cursor = { anchor: position(6), head: position(6) };
    const ytext = [...doc.getMap<Y.Text>("texts").values()][0];
    ytext.insert(0, "Oh, ");
    const [peer] = peersOf(
      open,
      awareness([[2, { user: { id: "u2", name: "Bo" }, file: "main.tex", cursor }]]),
      null,
    );
    expect(peer.selection).toEqual({ anchor: 10, head: 10 });
    expect(peer.text!.slice(10)).toBe("world.");
  });

  it("names a state the server hasn't vouched for Someone", () => {
    const [peer] = peersOf(open, awareness([[7, { file: "main.tex" }]]), null);
    expect(peer).toMatchObject({
      name: "Someone",
      userId: "client-7",
      selection: null,
    });
  });
});
