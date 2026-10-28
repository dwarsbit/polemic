import { useState, type ReactNode } from "react";
import {
  BookOpen,
  Check,
  FolderOpen,
  Monitor,
  Moon,
  Package,
  Palette,
  PencilLine,
  Search,
  SlidersHorizontal,
  Sparkles,
  SpellCheck,
  Sun,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleButton } from "@/components/ui/toggle-button";
import { ToggleButtonGroup } from "@/components/ui/toggle-button-group";
import { cn } from "@/lib/utils";

/**
 * The settings dialog, prototyped on mock state. Same width and height
 * as today; the structure and the copy change.
 */

export const SETTINGS_NOTES = [
  "Sections: seven pages instead of six groups of one page each. Spelling, grammar and the English variant move out of Editor into Writing; TeX & Compile becomes Compile; AI becomes Assistant. The group headers (GENERAL, EDITOR, …) go away.",
  "Nav: 184px, icons at 16px, 28px rows; the active row uses the accent surface. Search stays at the top of the nav and still searches every row.",
  "Page intro: each page opens with its title and one line saying what lives here, so a targeted open (Sources… from the menu) lands with context.",
  "Rows: label 14px medium, description 12px muted, controls right-aligned in a fixed 176px column so switches, selects and toggle groups line up down the page. Rows are 56px minimum.",
  "Cards: titled cards have the title inside the card at 14px medium, not a muted strip. The first card of a page is titled too, so nothing is untitled.",
  "Theme: three preview tiles (Light, Dark, System) with a indigo ring on the selected one, instead of a three-way toggle.",
  "Copy: sentence case everywhere; descriptions say what happens, not how it is implemented; no trailing periods on one-word labels; shortcuts in parentheses after the description.",
];

interface Row {
  id: string;
  label: string;
  description?: string;
  control: ReactNode;
  after?: ReactNode;
}
interface Card {
  title: string;
  rows: Row[];
}
interface Section {
  id: string;
  label: string;
  intro: string;
  icon: LucideIcon;
  cards: Card[];
}

function ThemeTile({
  id,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  id: "light" | "dark" | "system";
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  const dark = id === "dark";
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "group flex w-28 flex-col gap-1.5 rounded-lg p-1 text-left transition-colors",
        active ? "ring-2 ring-tint" : "hover:bg-accent",
      )}
    >
      <div
        className={cn(
          "relative h-16 w-full overflow-hidden rounded-md border",
          dark ? "bg-neutral-900" : "bg-white",
          id === "system" && "bg-[linear-gradient(135deg,white_50%,#171717_50%)]",
        )}
      >
        <div
          className={cn(
            "absolute top-2 left-2 h-2 w-10 rounded-sm",
            dark ? "bg-neutral-600" : "bg-neutral-300",
          )}
        />
        <div
          className={cn(
            "absolute top-6 left-2 h-1.5 w-16 rounded-sm",
            dark ? "bg-neutral-700" : "bg-neutral-200",
          )}
        />
        <div
          className={cn(
            "absolute top-9 left-2 h-1.5 w-12 rounded-sm",
            dark ? "bg-neutral-700" : "bg-neutral-200",
          )}
        />
        {active && (
          <span className="absolute right-1.5 bottom-1.5 flex size-4 items-center justify-center rounded-full bg-tint text-white">
            <Check className="size-2.5" />
          </span>
        )}
      </div>
      <span className="flex items-center gap-1 px-1 text-xs font-medium">
        <Icon className="size-3 text-muted-foreground" />
        {label}
      </span>
    </button>
  );
}

function RowView({ row }: { row: Row }) {
  return (
    <div className="py-3 first:pt-1 last:pb-1">
      <div className="flex min-h-8 items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium">{row.label}</p>
          {row.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>
          )}
        </div>
        <div className="flex w-44 shrink-0 justify-end">{row.control}</div>
      </div>
      {row.after}
    </div>
  );
}

function CardView({ card }: { card: Card }) {
  return (
    <section className="rounded-xl border bg-card px-4 py-3 shadow-xs">
      <p className="mb-2 text-sm font-medium">{card.title}</p>
      <div className="divide-y divide-border">
        {card.rows.map((row) => (
          <RowView key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}

function SelectControl({
  value,
  options,
  width = "w-44",
}: {
  value: string;
  options: string[];
  width?: string;
}) {
  const [v, setV] = useState(value);
  return (
    <Select value={v} onValueChange={setV}>
      <SelectTrigger className={cn("h-8 text-xs", width)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Toggle({ value, options }: { value: string; options: string[] }) {
  const [v, setV] = useState(value);
  return (
    <ToggleButtonGroup type="single" value={v} onValueChange={(x) => x && setV(x)}>
      {options.map((o) => (
        <ToggleButton key={o} value={o} size="sm" className="text-xs">
          {o}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

function Sw({ on = true }: { on?: boolean }) {
  const [v, setV] = useState(on);
  return <Switch checked={v} onCheckedChange={setV} />;
}

function useSections(): Section[] {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  return [
    {
      id: "general",
      label: "General",
      icon: SlidersHorizontal,
      intro: "Startup, where projects live, and how changes are tracked.",
      cards: [
        {
          title: "Projects",
          rows: [
            {
              id: "reopen",
              label: "Reopen the last project",
              description: "On launch, open the project you worked on last.",
              control: <Sw />,
            },
            {
              id: "root",
              label: "Projects folder",
              description:
                "New projects are created here. Existing projects stay where they are.",
              control: (
                <Button variant="outline" size="sm" className="text-xs">
                  <FolderOpen /> Choose…
                </Button>
              ),
              after: (
                <p className="mt-2 truncate rounded-md border bg-muted px-2 py-1 font-mono text-2xs text-muted-foreground">
                  ~/Documents/Polemic
                </p>
              ),
            },
            {
              id: "include",
              label: "Add new files to the main document",
              description:
                "A file created in the Files panel is included with \\input{} right away.",
              control: <Sw on={false} />,
            },
          ],
        },
        {
          title: "Version control",
          rows: [
            {
              id: "vc",
              label: "Track changes with",
              description:
                "Git when it is installed, snapshots otherwise. Snapshots work without git.",
              control: <Toggle value="Git" options={["Git", "Snapshots"]} />,
            },
          ],
        },
      ],
    },
    {
      id: "appearance",
      label: "Appearance",
      icon: Palette,
      intro: "Theme, editor font and the text cursor.",
      cards: [
        {
          title: "Theme",
          rows: [
            {
              id: "theme",
              label: "Mode",
              description:
                "System follows the light and dark setting of your computer.",
              control: null,
              after: (
                <div className="mt-2 flex gap-2">
                  <ThemeTile
                    id="light"
                    label="Light"
                    icon={Sun}
                    active={theme === "light"}
                    onClick={() => setTheme("light")}
                  />
                  <ThemeTile
                    id="dark"
                    label="Dark"
                    icon={Moon}
                    active={theme === "dark"}
                    onClick={() => setTheme("dark")}
                  />
                  <ThemeTile
                    id="system"
                    label="System"
                    icon={Monitor}
                    active={theme === "system"}
                    onClick={() => setTheme("system")}
                  />
                </div>
              ),
            },
          ],
        },
        {
          title: "Editor font",
          rows: [
            {
              id: "font",
              label: "Font",
              description:
                "Bundled with the app, so the editor looks the same on every machine.",
              control: (
                <SelectControl
                  value="JetBrains Mono"
                  options={[
                    "JetBrains Mono",
                    "Fira Code",
                    "Source Code Pro",
                    "IBM Plex Mono",
                  ]}
                />
              ),
            },
            {
              id: "size",
              label: "Size",
              control: (
                <SelectControl
                  value="14 px"
                  options={["12 px", "14 px", "16 px", "18 px"]}
                  width="w-24"
                />
              ),
            },
            {
              id: "syntax",
              label: "Syntax colors",
              description: "Each scheme has a light and a dark variant.",
              control: (
                <SelectControl
                  value="Polemic"
                  options={["Polemic", "GitHub", "Solarized", "Nord"]}
                />
              ),
            },
          ],
        },
        {
          title: "Text cursor",
          rows: [
            {
              id: "caret",
              label: "Shape",
              description: "A thin line, or a translucent block over the character.",
              control: <Toggle value="Line" options={["Line", "Block"]} />,
            },
            {
              id: "caret-color",
              label: "Color",
              description: "Theme follows light and dark; custom keeps one color.",
              control: <Toggle value="Theme" options={["Theme", "Custom"]} />,
            },
          ],
        },
      ],
    },
    {
      id: "editor",
      label: "Editor",
      icon: PencilLine,
      intro: "How the code editor behaves while you type and save.",
      cards: [
        {
          title: "Typing",
          rows: [
            {
              id: "supsub",
              label: "Braces after ^ and _",
              description: "Typing ^ or _ inserts {} with the cursor inside.",
              control: <Sw />,
            },
            {
              id: "dd",
              label: "Turn $$ into \\[ \\]",
              description: "The second $ of a pair becomes display-math brackets.",
              control: <Sw />,
            },
            {
              id: "math-preview",
              label: "Math preview on hover",
              description: "A card above a formula shows how it renders.",
              control: <Sw />,
            },
          ],
        },
        {
          title: "Saving",
          rows: [
            {
              id: "format",
              label: "Format on save",
              description:
                "Indent environments and normalize whitespace in .tex files (Shift+Alt+F formats now).",
              control: <Sw on={false} />,
            },
          ],
        },
      ],
    },
    {
      id: "writing",
      label: "Writing",
      icon: SpellCheck,
      intro: "Spelling and grammar checks, in both the code and the visual editor.",
      cards: [
        {
          title: "Spelling",
          rows: [
            {
              id: "spell",
              label: "Check spelling",
              description:
                "Right-click a marked word for corrections, or to add it to your dictionary.",
              control: <Sw />,
            },
            {
              id: "lang",
              label: "Language",
              description:
                "A language that is not installed yet is downloaded (10–20 MB).",
              control: (
                <SelectControl
                  value="English"
                  options={[
                    "English",
                    "German",
                    "French",
                    "Spanish",
                    "Italian",
                    "Dutch",
                  ]}
                  width="w-36"
                />
              ),
            },
          ],
        },
        {
          title: "Grammar and style",
          rows: [
            {
              id: "grammar",
              label: "Check grammar and style",
              description:
                "Marks issues in blue; right-click for the fix or to turn a rule off.",
              control: <Sw />,
            },
            {
              id: "variant",
              label: "English variant",
              control: (
                <SelectControl
                  value="American"
                  options={["American", "British", "Australian", "Canadian", "Indian"]}
                  width="w-36"
                />
              ),
            },
            {
              id: "engine",
              label: "Checker",
              description:
                "Built in, offline, English only. A LanguageTool server adds other languages.",
              control: (
                <Toggle value="Built in" options={["Built in", "LanguageTool"]} />
              ),
            },
          ],
        },
      ],
    },
    {
      id: "compile",
      label: "Compile",
      icon: Package,
      intro: "Your TeX distribution and the tools Polemic found on this computer.",
      cards: [
        {
          title: "TeX distribution",
          rows: [
            {
              id: "tl",
              label: "TeX Live 2025",
              description: "/Library/TeX/texbin",
              control: <StatusPill ok>Found</StatusPill>,
            },
            {
              id: "latexmk",
              label: "latexmk",
              description: "Runs the compile. Version 4.86.",
              control: <StatusPill ok>Found</StatusPill>,
            },
            {
              id: "biber",
              label: "biber",
              description: "Needed for biblatex bibliographies.",
              control: <StatusPill ok>Found</StatusPill>,
            },
            {
              id: "lua",
              label: "lualatex",
              description: "Used when the document class asks for it.",
              control: <StatusPill>Not found</StatusPill>,
            },
          ],
        },
      ],
    },
    {
      id: "bibliography",
      label: "Bibliography",
      icon: BookOpen,
      intro: "Where citations come from when you add one.",
      cards: [
        {
          title: "Sources",
          rows: [
            {
              id: "bib",
              label: "bibliography.bib",
              description: "In this project · 142 entries",
              control: <Sw />,
            },
            {
              id: "zotero",
              label: "Zotero (local)",
              description: "Connects to the Zotero app on this computer.",
              control: <Sw />,
            },
            {
              id: "zcloud",
              label: "Zotero cloud",
              description: "Not connected.",
              control: (
                <Button variant="outline" size="sm" className="text-xs">
                  Connect…
                </Button>
              ),
            },
          ],
        },
        {
          title: "Online lookup",
          rows: [
            {
              id: "doi",
              label: "Look up DOI and arXiv IDs online",
              description:
                "Fetches the entry from doi.org. Only the identifier you paste is sent. Off by default.",
              control: <Sw on={false} />,
            },
          ],
        },
      ],
    },
    {
      id: "assistant",
      label: "Assistant",
      icon: Sparkles,
      intro:
        "An optional AI provider for compile errors the built-in fixes cannot handle.",
      cards: [
        {
          title: "Provider",
          rows: [
            {
              id: "endpoint",
              label: "Endpoint",
              description: "Any OpenAI-compatible API.",
              control: (
                <Input
                  className="h-8 w-44 text-xs"
                  placeholder="https://api.mistral.ai/v1"
                />
              ),
            },
            {
              id: "key",
              label: "API key",
              description: "Stored in your system keychain.",
              control: (
                <Input
                  type="password"
                  className="h-8 w-44 text-xs"
                  value="••••••••••••"
                  readOnly
                />
              ),
            },
            {
              id: "model",
              label: "Model",
              control: (
                <Input
                  className="h-8 w-44 text-xs"
                  placeholder="mistral-large-latest"
                />
              ),
            },
          ],
        },
      ],
    },
  ];
}

function StatusPill({ ok, children }: { ok?: boolean; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-2xs font-medium",
        ok
          ? "border-success/30 bg-success/10 text-success"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {ok && <Check className="size-3" />}
      {children}
    </span>
  );
}

export function SettingsPage() {
  const sections = useSections();
  const [section, setSection] = useState("appearance");
  const active = sections.find((s) => s.id === section) ?? sections[0];

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-sidebar p-6">
      {/* Rendered inline (no portal, no overlay) so the lab toolbar stays
          usable; the chrome copies the app's DialogContent classes. */}
      <div
        role="dialog"
        className="relative flex h-[600px] max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-4xl bg-popover text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/5 dark:ring-foreground/10"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-4 right-4 bg-secondary"
        >
          <XIcon />
        </Button>
        <div className="px-5 pt-4 pb-3">
          <h1 className="font-heading text-base leading-none font-medium">Settings</h1>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[184px_1fr]">
          <nav className="flex min-h-0 flex-col border-r bg-muted/30 p-2">
            <div className="relative mb-2">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 rounded-lg pl-8 text-xs"
                placeholder="Search settings"
              />
            </div>
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={cn(
                  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-xs transition-colors",
                  active.id === id
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                onClick={() => setSection(id)}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 overflow-y-auto bg-muted/20">
            <div className="p-5">
              <h2 className="text-base font-semibold">{active.label}</h2>
              <p className="mt-0.5 mb-4 text-xs text-muted-foreground">
                {active.intro}
              </p>
              <div className="space-y-3">
                {active.cards.map((card) => (
                  <CardView key={card.title} card={card} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
