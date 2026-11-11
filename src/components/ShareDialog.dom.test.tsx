// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import type {
  AccountProject,
  ProjectMembers,
  ReviewLink,
  ShareStatus,
} from "@/lib/tauri";

/** The Rust side, as far as the dialog can tell. */
const server = {
  status: null as unknown as ShareStatus,
  links: [] as ReviewLink[],
  published: 0,
  publishError: null as unknown,
  info: null as AccountProject | null,
  people: { members: [], invites: [] } as ProjectMembers,
};

const ownerInfo = (): AccountProject => ({
  id: "p".repeat(22),
  name: "Thesis",
  role: "owner",
  writable: true,
  source: "linked",
  owner: { id: "ada", name: "Ada" },
  updatedAt: "2026-11-07T12:00:00.000Z",
});
const emptyUpdate = () => {
  let binary = "";
  for (const b of Y.encodeStateAsUpdate(new Y.Doc())) binary += String.fromCharCode(b);
  return btoa(binary);
};

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", () => ({
  // The project store resets the preview when the project changes.
  cancelCompile: vi.fn(async () => {}),
  isShareError: (v: unknown) =>
    typeof v === "object" && v !== null && "kind" in v && "message" in v,
  shareStatus: vi.fn(async () => server.status),
  shareFolder: vi.fn(async () => [{ path: "main.tex", kind: "text", text: "x" }]),
  shareCreate: vi.fn(async (_dir: string, name: string) => {
    server.status = {
      ...server.status,
      link: {
        server: server.status.server,
        projectId: "p".repeat(22),
        name,
        twoWay: true,
      },
    };
    return server.status.link;
  }),
  shareSync: vi.fn(async () => ({ update: emptyUpdate(), stateVector: "AA==" })),
  shareCommentState: vi.fn(async () => ({ seen: [], onDisk: [] })),
  shareSaveComments: vi.fn(async () => []),
  listComments: vi.fn(async () => []),
  shareUploadAssets: vi.fn(async () => {}),
  sharePush: vi.fn(async () => {}),
  sharePublish: vi.fn(async (_dir: string, main: string | null) => {
    if (server.publishError) throw server.publishError;
    server.published++;
    return {
      id: `s${server.published}`,
      main,
      pdf: "a".repeat(64),
      synctex: null,
      size: 10,
      createdAt: "2026-10-30T12:00:00.000Z",
    };
  }),
  shareSnapshots: vi.fn(async () =>
    server.published > 0
      ? [
          {
            id: "s1",
            main: "main.tex",
            pdf: "a".repeat(64),
            synctex: null,
            size: 10,
            createdAt: "2026-10-30T12:00:00.000Z",
          },
        ]
      : [],
  ),
  shareLinks: vi.fn(async () => server.links),
  shareCreateLink: vi.fn(async (_dir: string, role: "commenter" | "viewer") => {
    const made: ReviewLink = {
      id: `l${server.links.length + 1}`.padEnd(22, "x"),
      role,
      expiresAt: null,
      createdAt: "2026-10-30T12:05:00.000Z",
      active: true,
    };
    server.links = [made, ...server.links];
    return { ...made, url: "https://polemic.example.org/r/secret-token" };
  }),
  shareDeleteLink: vi.fn(async (_dir: string, id: string) => {
    server.links = server.links.filter((l) => l.id !== id);
  }),
  linkLoad: vi.fn(async () => ({ state: null, pending: [] })),
  linkSave: vi.fn(async () => {}),
  linkEnable: vi.fn(async () => server.status.link),
  readProjectFile: vi.fn(async () => "x"),
  onProjectFilesChanged: vi.fn(() => () => {}),
  shareInfo: vi.fn(async () => server.info ?? ownerInfo()),
  shareMembers: vi.fn(async () => structuredClone(server.people)),
  shareInvite: vi.fn(
    async (_dir: string, email: string, role: "editor" | "commenter") => {
      const invite = {
        id: "i".repeat(22),
        email,
        role,
        createdAt: "2026-11-07T12:00:00.000Z",
        expiresAt: "2026-11-21T12:00:00.000Z",
      };
      server.people.invites.unshift(invite);
      return invite;
    },
  ),
  shareCancelInvite: vi.fn(async (_dir: string, id: string) => {
    server.people.invites = server.people.invites.filter((i) => i.id !== id);
  }),
  shareSetRole: vi.fn(
    async (_dir: string, userId: string, role: "editor" | "commenter") => {
      const member = server.people.members.find((m) => m.userId === userId)!;
      member.role = role;
      return member;
    },
  ),
  shareRemoveMember: vi.fn(async (_dir: string, userId: string) => {
    server.people.members = server.people.members.filter((m) => m.userId !== userId);
  }),
  shareLeave: vi.fn(async () => {
    server.status = { ...server.status, link: null };
  }),
  gitStatus: vi.fn(async () => ({ remote: null })),
  shareStop: vi.fn(async () => {
    server.status = { ...server.status, link: null };
    server.published = 0;
    server.links = [];
  }),
}));

import { ShareDialog } from "@/components/ShareDialog";
import { SharePopover } from "@/components/SharePopover";
import * as tauri from "@/lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useDialogsStore } from "@/store/dialogs";
import { useProjectStore } from "@/store/project";
import { useSettingsStore } from "@/store/settings";
import { useLinkStore } from "@/store/link";

let root: Root | null = null;

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}

const render = () => mount(<ShareDialog open onOpenChange={() => {}} />);

/** The dialog and the popover render in a portal on the body. */
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;

async function click(label: string) {
  const target = button(label);
  if (!target) throw new Error(`no button ${label} in: ${text()}`);
  await act(async () => target.click());
}

async function clickLabeled(label: string) {
  const target = document.body.querySelector(
    `button[aria-label="${label}"]`,
  ) as HTMLButtonElement | null;
  if (!target) throw new Error(`no button labeled ${label} in: ${text()}`);
  await act(async () => target.click());
}

const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const linked = () => {
  server.status.link = {
    server: server.status.server,
    projectId: "p".repeat(22),
    name: "Thesis",
    twoWay: true,
  };
};

/** The open project's sync, as the app runs it for a shared project. */
const synced = async () => {
  linked();
  await act(async () => useLinkStore.getState().start("/home/ada/thesis"));
};

const copied: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  copied.length = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (value: string) => void copied.push(value) },
  });
  server.status = {
    server: "https://polemic.example.org",
    signedIn: true,
    link: null,
  };
  server.links = [];
  server.published = 0;
  server.publishError = null;
  server.info = null;
  server.people = { members: [], invites: [] };
  useProjectStore.setState({
    project: { name: "Thesis", path: "/home/ada/thesis" },
    mainFile: "main.tex",
  });
  useSettingsStore.setState({ settingsDialogOpen: false, settingsSection: null });
  useDialogsStore.setState({ shareOpen: false });
});
afterEach(() => {
  useLinkStore.getState().stop();
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ShareDialog", () => {
  it("asks a signed-out user to sign in", async () => {
    server.status = { ...server.status, signedIn: false };
    await render();
    expect(text()).toContain("Sharing needs a free Polemic account.");
    expect(button("Share project")).toBeUndefined();
    await click("Sign in");
    expect(useSettingsStore.getState().settingsSection).toBe("account");
  });

  it("shares the project, which then syncs", async () => {
    await render();
    expect(text()).not.toContain("People");
    await click("Share project");
    expect(tauri.shareCreate).toHaveBeenCalledWith("/home/ada/thesis", "Thesis");
    // The folder went up to the new server copy.
    expect(tauri.sharePush).toHaveBeenCalled();
    expect(useLinkStore.getState().status?.kind).toBe("synced");
    expect(text()).toContain("People");
    expect(text()).toContain("Review links");
    await click("Open in browser");
    expect(openUrl).toHaveBeenCalledWith(
      `https://polemic.example.org/projects/${"p".repeat(22)}`,
    );
    expect(tauri.sharePublish).not.toHaveBeenCalled();
  });

  it("publishes with the first link, then again when asked", async () => {
    await synced();
    await render();
    expect(text()).not.toContain("Last published");
    await click("Create link");
    expect(tauri.sharePublish).toHaveBeenCalledWith("/home/ada/thesis", "main.tex");
    // Synced before what reviewers see was fixed, and published before the link.
    expect(vi.mocked(tauri.sharePush).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(tauri.sharePublish).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(tauri.sharePublish).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(tauri.shareCreateLink).mock.invocationCallOrder[0],
    );
    expect(text()).toContain("Last published ");
    await click("Publish again");
    expect(tauri.sharePublish).toHaveBeenCalledTimes(2);
    expect(tauri.shareCreateLink).toHaveBeenCalledTimes(1);
  });

  it("copies a new link, keeps it to copy again and deletes it", async () => {
    linked();
    server.published = 1;
    await render();
    await click("Create link");
    expect(tauri.shareCreateLink).toHaveBeenCalledWith(
      "/home/ada/thesis",
      "commenter",
      null,
    );
    expect(tauri.sharePublish).not.toHaveBeenCalled();
    expect(copied).toEqual(["https://polemic.example.org/r/secret-token"]);
    expect(button("Copied")).toBeDefined();
    expect(text()).not.toContain("secret-token");

    // A later opening still has the address.
    act(() => root?.unmount());
    await render();
    await click("Copy link");
    expect(copied).toHaveLength(2);

    await clickLabeled("Delete link");
    expect(tauri.shareDeleteLink).toHaveBeenCalled();
    expect(button("Copy link")).toBeUndefined();
    expect(localStorage.getItem("polemic.reviewLinks")).toBe("{}");
  });

  it("offers no copy for a link made elsewhere", async () => {
    linked();
    server.published = 1;
    server.links = [
      {
        id: "a".repeat(22),
        role: "viewer",
        expiresAt: null,
        createdAt: "2026-10-30T12:05:00.000Z",
        active: true,
      },
    ];
    await render();
    expect(text()).toContain("can’t be copied on this device");
    expect(button("Copy link")).toBeUndefined();
  });

  it("marks links the plan has paused", async () => {
    linked();
    server.published = 1;
    server.links = [
      {
        id: "a".repeat(22),
        role: "viewer",
        expiresAt: null,
        createdAt: "2026-10-30T12:05:00.000Z",
        active: true,
      },
      {
        id: "b".repeat(22),
        role: "commenter",
        expiresAt: null,
        createdAt: "2026-10-29T12:05:00.000Z",
        active: false,
      },
    ];
    await render();
    const items = [...document.body.querySelectorAll("li")].map(
      (li) => li.textContent ?? "",
    );
    expect(items.filter((t) => t.includes("Paused"))).toHaveLength(1);
    expect(items.find((t) => t.includes("Paused"))).toContain("Can comment");
  });

  it("explains a server that asks for a paid plan, with the account page", async () => {
    await synced();
    server.publishError = {
      kind: "planRequired",
      message: "Sharing needs a paid plan on this server.",
    };
    await render();
    await click("Create link");
    expect(text()).toContain("Sharing needs a paid plan on this server.");
    expect(tauri.shareCreateLink).not.toHaveBeenCalled();
    await click("See plans");
    expect(openUrl).toHaveBeenCalledWith("https://polemic.example.org/account");
  });

  it("stops sharing only after a confirmation", async () => {
    linked();
    server.published = 1;
    await render();
    await click("Stop sharing…");
    expect(tauri.shareStop).not.toHaveBeenCalled();
    expect(text()).toContain("Your files stay on this computer.");
    await click("Stop sharing");
    expect(tauri.shareStop).toHaveBeenCalledWith("/home/ada/thesis");
    expect(useLinkStore.getState().status).toBeNull();
    expect(button("Share project")).toBeDefined();
    expect(text()).not.toContain("Review links");
  });

  it("invites people by email and lists them for the owner", async () => {
    linked();
    server.people.members = [
      {
        userId: "grace",
        name: "Grace",
        email: "grace@example.com",
        role: "editor",
        addedAt: "2026-11-06T12:00:00.000Z",
      },
    ];
    await render();
    expect(text()).toContain("People");
    expect(text()).toContain("grace@example.com");

    expect(button("Invite")!.disabled).toBe(true);
    const email = document.body.querySelector(
      'input[aria-label="Email address to invite"]',
    ) as HTMLInputElement;
    await type(email, "alan@example.com");
    await click("Invite");
    expect(tauri.shareInvite).toHaveBeenCalledWith(
      "/home/ada/thesis",
      "alan@example.com",
      "editor",
    );
    expect(text()).toContain("Invite sent to alan@example.com");
    expect(text()).toContain("Invited · can edit");

    await clickLabeled("Cancel the invite for alan@example.com");
    expect(tauri.shareCancelInvite).toHaveBeenCalledWith(
      "/home/ada/thesis",
      "i".repeat(22),
    );
    expect(text()).not.toContain("Invited · can edit");

    await clickLabeled("Remove Grace");
    expect(tauri.shareRemoveMember).toHaveBeenCalledWith("/home/ada/thesis", "grace");
    expect(text()).not.toContain("grace@example.com");
  });

  it("shows someone invited whose project it is, and lets them leave", async () => {
    linked();
    server.info = {
      ...ownerInfo(),
      role: "editor",
      owner: { id: "leon", name: "Leon" },
    };
    await render();
    expect(text()).toContain("Leon shared this project with you.");
    expect(text()).toContain("Can edit. Only Leon can invite people");
    // Owner-only parts are hidden, and nothing owner-only is asked for.
    expect(button("Create link")).toBeUndefined();
    expect(button("Stop sharing…")).toBeUndefined();
    expect(text()).not.toContain("People");
    expect(tauri.shareLinks).not.toHaveBeenCalled();
    expect(tauri.shareMembers).not.toHaveBeenCalled();

    await click("Leave project…");
    expect(tauri.shareLeave).not.toHaveBeenCalled();
    expect(text()).toContain("Your copy stays on this computer");
    await click("Leave project");
    expect(tauri.shareLeave).toHaveBeenCalledWith("/home/ada/thesis");
    expect(button("Share project")).toBeDefined();
  });

  it("says why a shared project isn't in sync, with a retry", async () => {
    linked();
    await render();
    await act(async () =>
      useLinkStore.setState({ status: { kind: "offline", message: "No connection" } }),
    );
    expect(text()).toContain("You're offline.");
    expect(button("Try again")).toBeDefined();
  });

  it("keeps a commenter's changes on this computer", async () => {
    linked();
    server.info = {
      ...ownerInfo(),
      role: "commenter",
      writable: false,
      owner: { id: "leon", name: "Leon" },
    };
    await act(async () => useLinkStore.getState().start("/home/ada/thesis"));
    expect(useLinkStore.getState().status?.kind).toBe("synced");
    expect(tauri.sharePush).not.toHaveBeenCalled();
  });

  it("warns once about a Git remote on a project others work on", async () => {
    linked();
    localStorage.clear();
    server.info = {
      ...ownerInfo(),
      role: "editor",
      owner: { id: "leon", name: "Leon" },
    };
    vi.mocked(tauri.gitStatus).mockResolvedValue({
      remote: "git@example.com:a/b.git",
    } as never);
    await act(async () => useLinkStore.getState().start("/home/ada/thesis"));
    expect(useLinkStore.getState().notice).toMatchObject({
      git: true,
      upgraded: false,
    });
    useLinkStore.getState().dismissNotice();
    await act(async () => useLinkStore.getState().start("/home/ada/thesis"));
    expect(useLinkStore.getState().notice).toBeNull();

    // The owner is warned only once someone else is in the project.
    localStorage.clear();
    server.info = null;
    await act(async () => useLinkStore.getState().start("/home/ada/thesis"));
    expect(useLinkStore.getState().notice).toBeNull();
  });
});

describe("SharePopover", () => {
  const openPopover = async () => {
    await mount(<SharePopover />);
    await click("Share");
  };

  it("starts with one step for a project that isn't shared", async () => {
    await openPopover();
    expect(text()).toContain("Share this project");
    expect(button("Create review link")).toBeUndefined();
    await click("Share project");
    expect(tauri.shareCreate).toHaveBeenCalledWith("/home/ada/thesis", "Thesis");
    expect(text()).toContain("Invite people");
    expect(button("Create review link")).toBeDefined();
  });

  it("invites someone and says who the project is shared with", async () => {
    linked();
    server.people.members = [
      {
        userId: "grace",
        name: "Grace",
        email: "grace@example.com",
        role: "editor",
        addedAt: "2026-11-06T12:00:00.000Z",
      },
    ];
    await openPopover();
    expect(text()).toContain("Shared with Grace");
    const email = document.body.querySelector(
      'input[aria-label="Email address to invite"]',
    ) as HTMLInputElement;
    await type(email, "alan@example.com");
    await click("Invite");
    expect(tauri.shareInvite).toHaveBeenCalledWith(
      "/home/ada/thesis",
      "alan@example.com",
      "editor",
    );
    expect(text()).toContain("Shared with Grace · 1 invite pending");
  });

  it("makes a review link once, then copies the same one", async () => {
    await synced();
    await openPopover();
    await click("Create review link");
    expect(tauri.sharePublish).toHaveBeenCalledWith("/home/ada/thesis", "main.tex");
    expect(tauri.shareCreateLink).toHaveBeenCalledWith(
      "/home/ada/thesis",
      "commenter",
      null,
    );
    expect(copied).toEqual(["https://polemic.example.org/r/secret-token"]);
    expect(button("Copied")).toBeDefined();

    // Opened again: the link is copied, not made anew.
    act(() => root?.unmount());
    await openPopover();
    await click("Copy review link");
    expect(tauri.shareCreateLink).toHaveBeenCalledTimes(1);
    expect(copied).toHaveLength(2);
  });

  it("opens the Share dialog for the rest", async () => {
    linked();
    await openPopover();
    await click("Manage sharing…");
    expect(useDialogsStore.getState().shareOpen).toBe(true);
    expect(text()).not.toContain("Invite people");
  });

  it("shows someone invited whose project it is, and lets them leave", async () => {
    linked();
    server.info = {
      ...ownerInfo(),
      role: "editor",
      owner: { id: "leon", name: "Leon" },
    };
    await openPopover();
    expect(text()).toContain("Shared by Leon");
    expect(text()).not.toContain("Invite people");
    expect(button("Manage sharing…")).toBeUndefined();
    await click("Leave project…");
    expect(tauri.shareLeave).not.toHaveBeenCalled();
    await click("Leave project");
    expect(tauri.shareLeave).toHaveBeenCalledWith("/home/ada/thesis");
  });
});
