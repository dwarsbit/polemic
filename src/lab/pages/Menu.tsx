import { LabSection } from "@/lab/Lab";
import { cn } from "@/lib/utils";

/**
 * The native OS menu: the structure the app builds today (lib.rs,
 * build_app_menu) next to the proposed one, drawn as menu bars with
 * every dropdown open. The Rust change is a reordering of the same
 * MenuItems plus a few new ones (marked).
 */

type Item = string | "—";
interface Menu {
  title: string;
  items: Item[];
  /** Items that do not exist yet. */
  added?: string[];
  note?: string;
}

const CURRENT_MAC: Menu[] = [
  {
    title: "Polemic",
    items: [
      "About Polemic",
      "—",
      "Keyboard Shortcuts  ⌘/",
      "Command Palette…  ⌘P",
      "Settings  ⌘,",
      "—",
      "Services",
      "Hide",
      "Hide Others",
      "Show All",
      "—",
      "Quit",
    ],
  },
  {
    title: "File",
    items: [
      "New Project  ⌘N",
      "—",
      "Save  ⌘S",
      "Format Document  ⇧⌥F",
      "Export PDF as…  ⌘E",
      "Reveal Build Folder  ⇧⌘E",
      "—",
      "Quit",
    ],
    note: "Quit twice (also in Polemic); no Open; Format is an edit action.",
  },
  {
    title: "Insert",
    items: [
      "Table…  ⇧⌘T",
      "Figure from Image…  ⌥⌘G",
      "TikZ Picture…  ⌥⌘T",
      "—",
      "Packages…  ⌥⌘P",
    ],
    note: "Before Edit, against the platform order. Packages is not an insert.",
  },
  {
    title: "Edit",
    items: ["Undo", "Redo", "—", "Cut", "Copy", "Paste", "—", "Select All"],
  },
  {
    title: "View",
    items: [
      "Go to Editor  ⌥⌘1",
      "Sources…  ⌥⌘2",
      "—",
      "Toggle Sidebar  ⌥⌘B",
      "Toggle PDF Preview  ⇧⌘P",
      "Toggle Right Panel  ⌘J",
      "—",
      "Search in Project…  ⇧⌘F",
      "Show Issues",
      "Show Compile Log",
    ],
    note: "Go to Editor is a leftover from the workspace modes; Sources… is a settings page.",
  },
];

const CURRENT_WIN: Menu[] = [
  {
    title: "File",
    items: [
      "New Project  Ctrl+N",
      "—",
      "Save  Ctrl+S",
      "Format Document",
      "Table…",
      "Figure from Image…",
      "TikZ Picture…",
      "Packages…",
      "Export PDF as…",
      "Reveal Build Folder",
      "—",
      "Toggle Sidebar",
      "Toggle PDF Preview",
      "Toggle Right Panel",
      "—",
      "Go to Editor",
      "Sources…",
      "—",
      "Search in Project…",
      "Show Issues",
      "Show Compile Log",
      "—",
      "Settings",
      "Keyboard Shortcuts",
      "Command Palette…",
      "About Polemic",
      "—",
      "Quit",
    ],
    note: "Everything in one menu, 24 items.",
  },
  {
    title: "Edit",
    items: ["Undo", "Redo", "—", "Cut", "Copy", "Paste", "—", "Select All"],
  },
];

const PROPOSED_FILE: Menu = {
  title: "File",
  items: [
    "New Project…  ⌘N",
    "Open Project…  ⌘O",
    "Open Recent  ▸",
    "—",
    "Save  ⌘S",
    "Compile  ⇧⌘R",
    "Export PDF…  ⌘E",
    "Reveal Build Folder  ⇧⌘E",
    "—",
    "Close Project  ⇧⌘W",
  ],
  added: ["Open Project…  ⌘O", "Open Recent  ▸", "Compile  ⇧⌘R", "Close Project  ⇧⌘W"],
  note: "Project lifecycle and output. Compile gets a menu item and a shortcut so it is discoverable and scriptable.",
};
const PROPOSED_EDIT: Menu = {
  title: "Edit",
  items: [
    "Undo",
    "Redo",
    "—",
    "Cut",
    "Copy",
    "Paste",
    "Select All",
    "—",
    "Find in File  ⌘F",
    "Find in Project…  ⇧⌘F",
    "—",
    "Format Document  ⇧⌥F",
    "Add Comment  ⌥⌘C",
  ],
  added: ["Find in File  ⌘F", "Add Comment  ⌥⌘C"],
  note: "Text actions. Format and the two searches move here from File and View.",
};
const PROPOSED_INSERT: Menu = {
  title: "Insert",
  items: [
    "Table…  ⇧⌘T",
    "Figure from Image…  ⌥⌘G",
    "TikZ Picture…  ⌥⌘T",
    "Table or Plot from CSV…",
    "—",
    "Citation…  ⇧⌘C",
    "Reference…",
    "—",
    "Footnote",
    "Display Math",
  ],
  added: [
    "Table or Plot from CSV…",
    "Citation…  ⇧⌘C",
    "Reference…",
    "Footnote",
    "Display Math",
  ],
  note: "Only things that put LaTeX at the cursor. Mirrors the toolbar's Insert menu.",
};
const PROPOSED_VIEW: Menu = {
  title: "View",
  items: [
    "Visual  ⌥⌘1",
    "Code  ⌥⌘2",
    "—",
    "Navigator  ⌥⌘B",
    "PDF Preview  ⇧⌘P",
    "Properties  ⌘J",
    "Issues  ⇧⌘M",
    "Compile Log",
    "—",
    "Command Palette…  ⌘P",
    "—",
    "Actual Size",
    "Zoom In  ⌘+",
    "Zoom Out  ⌘−",
  ],
  added: [
    "Visual  ⌥⌘1",
    "Code  ⌥⌘2",
    "Issues  ⇧⌘M",
    "Actual Size",
    "Zoom In  ⌘+",
    "Zoom Out  ⌘−",
  ],
  note: "Panels as checkmark items (✓ when shown) instead of “Toggle …”. The face switch takes the old workspace shortcuts.",
};
const PROPOSED_PROJECT: Menu = {
  title: "Project",
  items: [
    "Packages…  ⌥⌘P",
    "Document Settings…",
    "Bibliography Sources…",
    "—",
    "Take Snapshot",
    "Commit…  ⌘K",
  ],
  added: ["Document Settings…", "Take Snapshot", "Commit…  ⌘K"],
  note: "Per-project tools that are neither text nor view. Sources… moves here from View, Packages from Insert.",
};
const PROPOSED_HELP: Menu = {
  title: "Help",
  items: [
    "Polemic Help",
    "Keyboard Shortcuts  ⌘/",
    "—",
    "Report an Issue…",
    "—",
    "About Polemic",
  ],
  added: ["Polemic Help", "Report an Issue…"],
  note: "macOS gets the system search field for free. About stays in the app menu on macOS and lives here on Windows and Linux.",
};

const PROPOSED_MAC: Menu[] = [
  {
    title: "Polemic",
    items: [
      "About Polemic",
      "—",
      "Settings…  ⌘,",
      "—",
      "Services",
      "Hide Polemic",
      "Hide Others",
      "Show All",
      "—",
      "Quit Polemic  ⌘Q",
    ],
    note: "Shortcuts and the palette leave the app menu for Help and View.",
  },
  PROPOSED_FILE,
  PROPOSED_EDIT,
  PROPOSED_INSERT,
  PROPOSED_VIEW,
  PROPOSED_PROJECT,
  {
    title: "Window",
    items: ["Minimize", "Zoom", "—", "Bring All to Front"],
    note: "Standard, was missing.",
  },
  {
    ...PROPOSED_HELP,
    items: PROPOSED_HELP.items.filter((i) => i !== "About Polemic").slice(0, -1),
  },
];

const PROPOSED_WIN: Menu[] = [
  { ...PROPOSED_FILE, items: [...PROPOSED_FILE.items, "—", "Exit  Alt+F4"] },
  { ...PROPOSED_EDIT, items: [...PROPOSED_EDIT.items, "—", "Settings…  Ctrl+,"] },
  PROPOSED_INSERT,
  PROPOSED_VIEW,
  PROPOSED_PROJECT,
  PROPOSED_HELP,
];

function MenuBar({ menus, dense }: { menus: Menu[]; dense?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-xs">
      <div className="flex flex-wrap items-start gap-3">
        {menus.map((menu) => (
          <div key={menu.title} className={cn("shrink-0", dense ? "w-44" : "w-48")}>
            <div className="mb-1 inline-block rounded-md bg-accent px-2 py-0.5 text-xs font-medium">
              {menu.title}
            </div>
            <ul className="rounded-lg border bg-popover py-1 shadow-md">
              {menu.items.map((item, i) =>
                item === "—" ? (
                  <li key={i} className="my-1 border-t" />
                ) : (
                  <li
                    key={i}
                    className={cn(
                      "flex justify-between gap-2 px-2.5 py-[3px] text-xs",
                      menu.added?.includes(item) && "text-tint-foreground",
                    )}
                  >
                    <span>{item.split("  ")[0]}</span>
                    <span className="text-muted-foreground">
                      {item.split("  ")[1] ?? ""}
                    </span>
                  </li>
                ),
              )}
            </ul>
            {menu.note && (
              <p className="mt-1.5 text-2xs text-muted-foreground">{menu.note}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MenuPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Native menus</h1>
      <p className="mb-8 max-w-2xl text-sm text-muted-foreground">
        The platform order is File, Edit, then the app's own menus, then Window and
        Help. Items in violet do not exist yet; everything else is the same MenuItem
        moved. Shortcuts shown as macOS; Windows and Linux map ⌘ to Ctrl.
      </p>

      <LabSection title="Proposed · macOS">
        <MenuBar menus={PROPOSED_MAC} dense />
      </LabSection>
      <LabSection
        title="Proposed · Windows and Linux"
        note="The same menus without the app menu: Settings lands at the end of Edit, Exit at the end of File, About in Help."
      >
        <MenuBar menus={PROPOSED_WIN} />
      </LabSection>
      <LabSection title="Today · macOS">
        <MenuBar menus={CURRENT_MAC} />
      </LabSection>
      <LabSection title="Today · Windows and Linux">
        <MenuBar menus={CURRENT_WIN} />
      </LabSection>

      <LabSection
        title="Rules"
        note="Applied to every item above and to the context menus (files, outline, bibliography)."
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>
            Title Case in native menus on every platform; sentence case inside the app.
          </li>
          <li>
            An ellipsis when the item opens a dialog or needs more input; none when it
            acts at once.
          </li>
          <li>
            Panels are checkmark items named after the panel (Navigator, PDF Preview),
            never “Toggle” or “Show”.
          </li>
          <li>
            One home per action: an item appears in exactly one menu, and the command
            palette mirrors the menus.
          </li>
          <li>
            Project-only items are disabled, not hidden, when no project is open (as
            today).
          </li>
        </ul>
      </LabSection>
    </>
  );
}
