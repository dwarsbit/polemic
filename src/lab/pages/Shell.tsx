import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  FileCog,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GalleryVertical,
  GitBranch,
  History,
  Images,
  Info,
  ListTree,
  MessageSquare,
  Package,
  Pencil,
  Play,
  ScrollText,
  Search,
  Sigma,
  Sparkles,
  Star,
  Tags,
  TriangleAlert,
  Wrench,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * The app shell, prototyped: the window chrome (header, rails, status
 * bar) and the floating cards (navigator, editor, preview, properties,
 * issues) on mock data. What changed against the shipped shell is
 * listed under the "What changed" button, top right.
 */

export const SHELL_NOTES = [
  "Backdrop: the window behind the cards is one step darker than the cards (sidebar token), so they read as floating in light mode too. Gaps 8px, outer padding 8px, resize handles live in the gaps.",
  "Header: 44px (was 48). The project name is a switcher button (open, rename, switch in a menu) instead of hover-revealed pencil and folder icons. Compile is the primary button; auto-compile and preview are toggles next to it.",
  "Rails: 40px wide; the active icon gets the accent surface and a 2px indigo bar on the window edge. The two action icons (packages, document settings) sit below a divider as before.",
  "Panel header: one component everywhere (36px, sentence-case title, optional count, actions right, hairline below). Replaces ALL-CAPS muted labels and the three ad-hoc headers (preview, issues, search).",
  "Lists: 28px rows, 12px text; the selected row is indigo-tinted, hover is the accent surface. Meta text (counts, line numbers, paths) is 11px muted.",
  "Tabs: 36px bar; the active tab opens into the editor as before, the dirty dot is indigo. The breadcrumb and the toolbar keep their rows.",
  "Status bar: 28px (was 32), 11px text, a colored dot for the compile state instead of an icon per state.",
  "Colors: mist gray scale, near-black primary, indigo only for focus, selection, selected rows and pills; success, warning, destructive and info are tokens.",
];

type LeftTab =
  "files" | "outline" | "symbols" | "assets" | "floats" | "labels" | "bibliography";
type Tool = "issues" | "log" | "search";
type RightTab = "git" | "history" | "comments" | "properties";

const NAVIGATOR_TABS: { id: LeftTab; label: string; icon: LucideIcon }[] = [
  { id: "files", label: "Files", icon: Folder },
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "symbols", label: "Symbols", icon: Sigma },
  { id: "assets", label: "Assets", icon: Images },
  { id: "floats", label: "Figures & tables", icon: GalleryVertical },
  { id: "labels", label: "Labels", icon: Tags },
  { id: "bibliography", label: "Bibliography", icon: BookOpen },
];

const TOOLS: { id: Tool; label: string; icon: LucideIcon }[] = [
  { id: "issues", label: "Issues", icon: AlertTriangle },
  { id: "log", label: "Compile log", icon: ScrollText },
  { id: "search", label: "Search in project", icon: Search },
];

const RIGHT_TABS: { id: RightTab; label: string; icon: LucideIcon }[] = [
  { id: "git", label: "Git", icon: GitBranch },
  { id: "history", label: "History", icon: History },
  { id: "comments", label: "Comments", icon: MessageSquare },
  { id: "properties", label: "Properties", icon: Info },
];

const FILES: {
  name: string;
  depth: number;
  kind: "dir" | "tex" | "bib" | "other";
  main?: boolean;
  status?: "changed" | "added";
}[] = [
  { name: "main.tex", depth: 0, kind: "tex", main: true, status: "changed" },
  { name: "chapters", depth: 0, kind: "dir" },
  { name: "introduction.tex", depth: 1, kind: "tex" },
  { name: "methods.tex", depth: 1, kind: "tex", status: "changed" },
  { name: "results.tex", depth: 1, kind: "tex", status: "added" },
  { name: "discussion.tex", depth: 1, kind: "tex" },
  { name: "figures", depth: 0, kind: "dir" },
  { name: "bibliography.bib", depth: 0, kind: "bib" },
  { name: "preamble.tex", depth: 0, kind: "tex" },
];

const CODE: { n: number; tokens: [string, string][] }[] = [
  {
    n: 41,
    tokens: [
      ["kw", "\\section"],
      ["br", "{"],
      ["", "Methods"],
      ["br", "}"],
      ["kw", "\\label"],
      ["br", "{"],
      ["arg", "sec:methods"],
      ["br", "}"],
    ],
  },
  { n: 42, tokens: [] },
  {
    n: 43,
    tokens: [
      ["", "We collected "],
      ["math", "$n = 1{,}240$"],
      ["", " responses between March and"],
    ],
  },
  {
    n: 44,
    tokens: [
      ["", "June 2025 (see Table~"],
      ["kw", "\\ref"],
      ["br", "{"],
      ["arg", "tab:sample"],
      ["br", "}"],
      ["", "). Each respondent"],
    ],
  },
  {
    n: 45,
    tokens: [
      ["", "completed the survey described by "],
      ["kw", "\\textcite"],
      ["br", "{"],
      ["arg", "smith2024"],
      ["br", "}"],
      ["", "."],
    ],
  },
  { n: 46, tokens: [] },
  {
    n: 47,
    tokens: [
      ["kw", "\\begin"],
      ["br", "{"],
      ["env", "equation"],
      ["br", "}"],
      ["kw", "\\label"],
      ["br", "{"],
      ["arg", "eq:model"],
      ["br", "}"],
    ],
  },
  { n: 48, tokens: [["math", "  y_i = \\beta_0 + \\beta_1 x_i + \\varepsilon_i"]] },
  {
    n: 49,
    tokens: [
      ["kw", "\\end"],
      ["br", "{"],
      ["env", "equation"],
      ["br", "}"],
    ],
  },
  { n: 50, tokens: [] },
  {
    n: 51,
    tokens: [
      ["", "The model in Equation~"],
      ["kw", "\\ref"],
      ["br", "{"],
      ["arg", "eq:model"],
      ["br", "}"],
      ["", " assumes homoscedastic"],
    ],
  },
  {
    n: 52,
    tokens: [
      ["", "errors; we relax this in Section~"],
      ["kw", "\\ref"],
      ["br", "{"],
      ["arg", "sec:robustness"],
      ["br", "}"],
      ["", "."],
    ],
  },
  { n: 53, tokens: [["cm", "% TODO: add the robustness checks from the appendix"]] },
  { n: 54, tokens: [] },
  {
    n: 55,
    tokens: [
      ["kw", "\\subsection"],
      ["br", "{"],
      ["", "Sampling"],
      ["br", "}"],
    ],
  },
];

const TOKEN_CLASS: Record<string, string> = {
  kw: "text-tint-foreground",
  br: "text-muted-foreground",
  arg: "text-info",
  env: "text-success",
  math: "text-warning",
  cm: "text-muted-foreground italic",
};

const ISSUES: {
  kind: "error" | "warning" | "info";
  text: string;
  where: string;
  fix?: boolean;
}[] = [
  {
    kind: "error",
    text: "Undefined control sequence \\textcite",
    where: "chapters/methods.tex:45",
    fix: true,
  },
  { kind: "error", text: "Missing $ inserted", where: "chapters/results.tex:12" },
  {
    kind: "warning",
    text: "Reference `sec:robustness' on page 4 undefined",
    where: "chapters/methods.tex:52",
  },
  {
    kind: "warning",
    text: "Overfull \\hbox (12.4pt too wide) in paragraph",
    where: "chapters/introduction.tex:31",
  },
  {
    kind: "info",
    text: "Package biblatex: rerun to get citations correct",
    where: "main.tex",
  },
];

/* ------------------------------------------------------------------ */

function RailButton({
  label,
  icon: Icon,
  active,
  side,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  side: "left" | "right";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-current={active}
      className={cn(
        "relative flex size-8 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        // The indigo bar on the window edge marks the open panel.
        active &&
          "after:absolute after:top-1.5 after:bottom-1.5 after:w-0.5 after:rounded-full after:bg-tint",
        active && (side === "left" ? "after:-left-2" : "after:-right-2"),
      )}
      onClick={onClick}
    >
      <Icon className="size-4" />
    </button>
  );
}

function PanelHeader({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number | string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
      <span className="text-xs font-medium">{title}</span>
      {count !== undefined && (
        <span className="text-2xs tabular-nums text-muted-foreground">{count}</span>
      )}
      {children}
      {actions && <div className="ml-auto flex items-center gap-0.5">{actions}</div>}
    </div>
  );
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs",
        className,
      )}
    >
      {children}
    </div>
  );
}

function IconAction({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title={label}
      className="text-muted-foreground"
    >
      <Icon className="size-3.5" />
    </Button>
  );
}

/* ------------------------------------------------------------------ */

function Header({
  face,
  setFace,
}: {
  face: "visual" | "code";
  setFace: (f: "visual" | "code") => void;
}) {
  const [auto, setAuto] = useState(true);
  const [preview, setPreview] = useState(true);
  return (
    <header className="flex h-11 shrink-0 items-center px-3">
      <div className="flex min-w-0 flex-1 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-1 max-w-72 gap-1.5 px-2">
              <FolderOpen className="size-3.5 text-muted-foreground" />
              <span className="truncate">Survey methods thesis</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem>
              <Pencil /> Rename project…
            </DropdownMenuItem>
            <DropdownMenuItem>
              <FolderOpen /> Show in Finder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Switch project…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        className="flex shrink-0 items-center rounded-lg bg-accent/60 p-0.5"
        role="tablist"
        aria-label="Editor face"
      >
        {(["visual", "code"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={face === id}
            className={cn(
              "rounded-md px-2.5 py-0.5 text-xs font-medium capitalize transition-colors",
              face === id
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setFace(id)}
          >
            {id}
          </button>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-end gap-2">
        <Button
          variant={preview ? "secondary" : "ghost"}
          size="icon-sm"
          title={preview ? "Hide PDF preview" : "Show PDF preview"}
          aria-pressed={preview}
          onClick={() => setPreview((v) => !v)}
        >
          <Eye />
        </Button>
        <ButtonGroup>
          <Button
            variant={auto ? "secondary" : "outline"}
            size="icon-sm"
            title={auto ? "Auto-compile on save: on" : "Auto-compile on save: off"}
            aria-pressed={auto}
            onClick={() => setAuto((v) => !v)}
          >
            <Zap className={cn(auto && "text-tint-foreground")} />
          </Button>
          <Button size="sm">
            <Play /> Compile
          </Button>
        </ButtonGroup>
      </div>
    </header>
  );
}

function FilesPanel() {
  const [selected, setSelected] = useState("methods.tex");
  return (
    <>
      <PanelHeader
        title="Files"
        actions={
          <>
            <IconAction icon={FilePlus2} label="New file" />
            <IconAction icon={FolderPlus} label="New folder" />
          </>
        }
      />
      <ul className="flex-1 overflow-y-auto p-1.5 text-xs">
        {FILES.map((f) => {
          const active = f.name === selected;
          const Icon =
            f.kind === "dir" ? Folder : f.kind === "bib" ? BookOpen : FileText;
          return (
            <li key={f.name}>
              <button
                type="button"
                className={cn(
                  "group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left",
                  active ? "bg-tint-soft text-foreground" : "hover:bg-accent",
                )}
                style={{ paddingLeft: 8 + f.depth * 14 }}
                onClick={() => f.kind !== "dir" && setSelected(f.name)}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
                {f.main && (
                  <Star className="size-3 shrink-0 fill-warning text-warning" />
                )}
                {f.status && (
                  <span
                    className={cn(
                      "ml-auto font-mono text-2xs",
                      f.status === "added" ? "text-success" : "text-info",
                    )}
                  >
                    {f.status === "added" ? "A" : "M"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function EditorCard({ face }: { face: "visual" | "code" }) {
  const tabs = [
    { name: "main.tex", dirty: false },
    { name: "methods.tex", dirty: true, active: true },
    { name: "bibliography.bib", dirty: false },
  ];
  return (
    <Card className="flex-1">
      <div className="relative flex h-9 shrink-0 items-end gap-0.5 bg-muted/40 px-1.5 pt-1 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border">
        {tabs.map((tab) => (
          <div
            key={tab.name}
            className={cn(
              "group flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border px-2.5 text-xs",
              tab.active
                ? "relative z-10 border-border border-b-transparent bg-card text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/60",
            )}
          >
            <span className="max-w-40 truncate">{tab.name}</span>
            <span
              className={cn(
                "size-1.5 rounded-full",
                tab.dirty ? "bg-tint" : "bg-transparent",
              )}
            />
            <button
              type="button"
              className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
              title="Close tab"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex h-6 shrink-0 items-center gap-1 border-b px-3 text-2xs text-muted-foreground">
        <span>main.tex</span>
        <ChevronRight className="size-3" />
        <span className="text-foreground">chapters/methods.tex</span>
      </div>
      {face === "code" && (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 px-2 text-xs text-muted-foreground"
          >
            Insert <ChevronDown className="size-3" />
          </Button>
          <Separator orientation="vertical" className="h-5 data-vertical:self-center" />
          <ButtonGroup>
            {[Images, GalleryVertical, ListTree, Sigma].map((Icon, i) => (
              <Button key={i} variant="ghost" size="icon-sm">
                <Icon className="size-4 text-muted-foreground" />
              </Button>
            ))}
          </ButtonGroup>
          <Separator orientation="vertical" className="h-5 data-vertical:self-center" />
          <ButtonGroup>
            {["B", "I", "U"].map((t) => (
              <Button
                key={t}
                variant="ghost"
                size="icon-sm"
                className="font-serif text-muted-foreground"
              >
                {t}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {face === "code" ? (
          <pre className="px-0 py-2 font-mono text-[13px] leading-6">
            {CODE.map((line) => (
              <div
                key={line.n}
                className={cn("flex", line.n === 45 && "bg-destructive/5")}
              >
                <span
                  className={cn(
                    "w-12 shrink-0 select-none pr-3 text-right text-muted-foreground/70",
                    // Git change bar (info) and the lint error bar (destructive).
                    line.n === 44 && "shadow-[inset_3px_0_0_var(--info)]",
                    line.n === 45 && "shadow-[inset_3px_0_0_var(--destructive)]",
                  )}
                >
                  {line.n}
                </span>
                <span className="pr-4">
                  {line.tokens.map(([kind, text], i) => (
                    <span key={i} className={TOKEN_CLASS[kind]}>
                      {text}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </pre>
        ) : (
          <div className="mx-auto max-w-2xl px-10 py-8 text-[15px] leading-relaxed">
            <h2 className="mb-3 text-2xl font-semibold">Methods</h2>
            <p className="mb-3">
              We collected <span className="font-serif italic">n = 1,240</span>{" "}
              responses between March and June 2025 (see Table{" "}
              <span className="rounded-full border border-tint-edge bg-tint-soft px-1.5 font-mono text-xs text-tint-foreground">
                tab:sample
              </span>
              ). Each respondent completed the survey described by{" "}
              <span className="rounded-full border border-tint-edge bg-tint-soft px-1.5 font-mono text-xs text-tint-foreground">
                smith2024
              </span>
              .
            </p>
            <p className="my-4 text-center font-serif italic">
              y<sub>i</sub> = β<sub>0</sub> + β<sub>1</sub>x<sub>i</sub> + ε<sub>i</sub>
            </p>
            <p>
              The model assumes homoscedastic errors; we relax this in Section{" "}
              <span className="rounded-full border border-destructive/40 bg-destructive/10 px-1.5 font-mono text-xs text-destructive">
                sec:robustness
              </span>
              .
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function PreviewCard() {
  return (
    <Card className="w-[30%]">
      <PanelHeader title="Preview">
        <div className="ml-auto flex items-center gap-1">
          <IconAction icon={ChevronLeft} label="Previous page" />
          <span className="w-12 text-center text-2xs tabular-nums text-muted-foreground">
            4 / 12
          </span>
          <IconAction icon={ChevronRight} label="Next page" />
          <Separator
            orientation="vertical"
            className="mx-1 h-4 data-vertical:self-center"
          />
          <IconAction icon={ZoomOut} label="Zoom out" />
          <span className="w-9 text-center text-2xs tabular-nums text-muted-foreground">
            110%
          </span>
          <IconAction icon={ZoomIn} label="Zoom in" />
        </div>
      </PanelHeader>
      <div className="flex-1 overflow-auto bg-muted/50 p-4">
        <div className="mx-auto aspect-[1/1.414] w-full max-w-[420px] rounded-sm bg-white p-8 shadow-md ring-1 ring-black/5">
          <div className="mb-4 h-3 w-1/3 rounded bg-neutral-800/80" />
          {Array.from({ length: 18 }, (_, i) => (
            <div
              key={i}
              className="mb-2 h-1.5 rounded bg-neutral-400/40"
              style={{
                width: `${[100, 96, 98, 88, 100, 94, 60, 0, 100, 97, 92, 99, 95, 70, 0, 100, 93, 80][i]}%`,
              }}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

function GitCard() {
  const changes = [
    { path: "chapters/methods.tex", state: "M" },
    { path: "chapters/results.tex", state: "A" },
    { path: "main.tex", state: "M" },
  ];
  return (
    <>
      <PanelHeader title="Git" actions={<IconAction icon={History} label="History" />}>
        <span className="flex items-center gap-1 text-2xs text-muted-foreground">
          <GitBranch className="size-3" /> main
        </span>
      </PanelHeader>
      <div className="flex-1 overflow-y-auto p-1.5">
        <p className="px-1.5 pt-1 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          Changes
          <span className="ml-1 normal-case tracking-normal">{changes.length}</span>
        </p>
        <ul className="text-xs">
          {changes.map((c) => (
            <li
              key={c.path}
              className="flex h-7 items-center gap-2 rounded-md px-2 hover:bg-accent"
            >
              <span
                className={cn(
                  "w-3 text-center font-mono text-2xs",
                  c.state === "A" ? "text-success" : "text-info",
                )}
              >
                {c.state}
              </span>
              <span className="truncate">{c.path}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t p-2">
        <textarea
          className="mb-2 h-16 w-full resize-none rounded-md border bg-input/50 px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          placeholder="Commit message"
        />
        <div className="flex items-center justify-between">
          <span className="text-2xs text-muted-foreground">3 files</span>
          <Button size="xs">Commit</Button>
        </div>
      </div>
    </>
  );
}

function IssuesCard({ tool }: { tool: Tool }) {
  const title =
    tool === "issues" ? "Issues" : tool === "log" ? "Compile log" : "Search in project";
  return (
    <Card className="h-44 shrink-0">
      <PanelHeader
        title={title}
        actions={<IconAction icon={ChevronDown} label="Hide panel" />}
      >
        {tool === "issues" && (
          <span className="flex items-center gap-2 text-2xs">
            <span className="flex items-center gap-1 text-destructive">
              <CircleAlert className="size-3" /> 2 errors
            </span>
            <span className="flex items-center gap-1 text-warning">
              <TriangleAlert className="size-3" /> 2 warnings
            </span>
          </span>
        )}
      </PanelHeader>
      {tool === "issues" ? (
        <ul className="flex-1 overflow-y-auto p-1.5 text-xs">
          {ISSUES.map((issue, i) => {
            const Icon =
              issue.kind === "error"
                ? CircleAlert
                : issue.kind === "warning"
                  ? TriangleAlert
                  : Info;
            return (
              <li
                key={i}
                className="group flex h-7 items-center gap-2 rounded-md px-2 hover:bg-accent"
              >
                <Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    issue.kind === "error"
                      ? "text-destructive"
                      : issue.kind === "warning"
                        ? "text-warning"
                        : "text-info",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{issue.text}</span>
                <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                  {issue.fix && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-5 px-1.5 text-2xs text-muted-foreground"
                    >
                      <Wrench className="size-3" /> Fix
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-5 px-1.5 text-2xs text-muted-foreground"
                  >
                    <Sparkles className="size-3" /> Ask AI
                  </Button>
                </span>
                <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                  {issue.where}
                </span>
              </li>
            );
          })}
        </ul>
      ) : tool === "log" ? (
        <pre className="flex-1 overflow-auto p-3 font-mono text-2xs leading-5 text-muted-foreground">
          {`This is LuaHBTeX, Version 1.18.0 (TeX Live 2025)
 restricted system commands enabled.
(./main.tex
LaTeX2e <2024-11-01> patch level 2
(./chapters/methods.tex
! Undefined control sequence.
l.45 ...the survey described by \\textcite`}
        </pre>
      ) : (
        <div className="flex flex-1 flex-col p-2">
          <input
            className="h-7 rounded-md border bg-input/50 px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
            placeholder="Search in project"
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Type to search every .tex and .bib file.
          </p>
        </div>
      )}
    </Card>
  );
}

function StatusBar() {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between px-3 text-2xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate">chapters/methods.tex</span>
        <span className="tabular-nums">1,842 words</span>
        <span className="tabular-nums">Ln 45, Col 38</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-destructive">
          <span className="size-1.5 rounded-full bg-destructive" />2 errors · lualatex
        </span>
        <span className="flex items-center gap-1.5">
          <Check className="size-3 text-success" />
          TeX Live 2025
        </span>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */

export function ShellPage() {
  const [face, setFace] = useState<"visual" | "code">("code");
  const [nav, setNav] = useState<LeftTab | null>("files");
  const [tool, setTool] = useState<Tool | null>("issues");
  const [right, setRight] = useState<RightTab | null>("git");

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar text-foreground">
      <Header face={face} setFace={setFace} />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-10 shrink-0 flex-col items-center gap-1 py-1 pl-2">
          {NAVIGATOR_TABS.map((tab) => (
            <RailButton
              key={tab.id}
              side="left"
              label={tab.label}
              icon={tab.icon}
              active={nav === tab.id}
              onClick={() => setNav((v) => (v === tab.id ? null : tab.id))}
            />
          ))}
          <div className="my-1 w-5 border-t" />
          <RailButton side="left" label="Packages" icon={Package} />
          <RailButton side="left" label="Document settings" icon={FileCog} />
          <div className="mt-auto flex flex-col items-center gap-1">
            {TOOLS.map((t) => (
              <RailButton
                key={t.id}
                side="left"
                label={t.label}
                icon={t.icon}
                active={tool === t.id}
                onClick={() => setTool((v) => (v === t.id ? null : t.id))}
              />
            ))}
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-2 pt-1">
          <div className="flex min-h-0 flex-1 gap-2">
            {nav && (
              <Card className="w-60">
                {nav === "files" ? (
                  <FilesPanel />
                ) : (
                  <>
                    <PanelHeader
                      title={NAVIGATOR_TABS.find((t) => t.id === nav)!.label}
                    />
                    <EmptyState
                      text={`The ${nav} panel keeps its content; only the header changes.`}
                    />
                  </>
                )}
              </Card>
            )}
            <EditorCard face={face} />
            <PreviewCard />
            {right && (
              <Card className="w-60">
                {right === "git" ? (
                  <GitCard />
                ) : (
                  <>
                    <PanelHeader
                      title={RIGHT_TABS.find((t) => t.id === right)!.label}
                    />
                    <EmptyState text="Nothing here yet." />
                  </>
                )}
              </Card>
            )}
          </div>
          {tool && <IssuesCard tool={tool} />}
        </div>
        <nav className="flex w-10 shrink-0 flex-col items-center gap-1 py-1 pr-2">
          {RIGHT_TABS.map((tab) => (
            <RailButton
              key={tab.id}
              side="right"
              label={tab.label}
              icon={tab.icon}
              active={right === tab.id}
              onClick={() => setRight((v) => (v === tab.id ? null : tab.id))}
            />
          ))}
          <div className="mt-auto">
            <RailButton side="right" label="Snapshots" icon={Camera} />
          </div>
        </nav>
      </div>
      <StatusBar />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <p className="max-w-48 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
