import { useEffect, useRef, useState } from "react";
import {
  BoldIcon,
  CalendarIcon,
  CheckIcon,
  FileTextIcon,
  ItalicIcon,
  QuoteIcon,
  TableIcon,
  TagIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleButton } from "@/components/ui/toggle-button";
import { ToggleButtonGroup } from "@/components/ui/toggle-button-group";
import { Calendar } from "@/components/ui/calendar";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SectionHeader } from "@/components/SectionHeader";

/**
 * The component gallery: every UI primitive with its variants and
 * states, plus the composed patterns the app is built from. A dev
 * tool, opened from the Develop menu — the menu item (and this
 * component, via the import.meta.env.DEV guard in App.tsx) only
 * exist in dev builds.
 */

const COLOR_TOKENS: { token: string; role: string }[] = [
  { token: "background", role: "Base surface" },
  { token: "card", role: "Raised surface" },
  { token: "popover", role: "Menus and popovers" },
  { token: "foreground", role: "Base text" },
  { token: "primary", role: "Emphasis" },
  { token: "primary-foreground", role: "Text on primary" },
  { token: "mauve-700", role: "Primary button fill" },
  { token: "mauve-900", role: "Primary button border" },
  { token: "secondary", role: "Quiet emphasis" },
  { token: "muted", role: "Muted surface" },
  { token: "muted-foreground", role: "Secondary text" },
  { token: "accent", role: "Hover surface" },
  { token: "destructive", role: "Errors and danger" },
  { token: "border", role: "Hairlines" },
  { token: "input", role: "Input fill" },
  { token: "ring", role: "Focus ring" },
];

const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;

const BUTTON_SIZES = ["xs", "sm", "default", "lg"] as const;

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Tile({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4",
        className,
      )}
    >
      {label && (
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** Format a picked day the way \date stores it: YYYY-MM-DD. */
function formatYMD(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The visual editor's preamble card, as a React demo inside the
 * `.visual-editor` typography scope (the same CSS the editor's node
 * view uses): summary bar with expand chevron, the metadata pills
 * row, and the collapsed raw remainder.
 */
function PreambleCardDemo() {
  const [expanded, setExpanded] = useState(false);
  const rest = [
    "% a custom command",
    "\\newcommand{\\foo}{bar}",
    "\\geometry{margin=1in}",
    "",
    "\\DeclareMathOperator{\\Res}{Res}",
  ].join("\n");
  const restLines = rest
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
  const parts = ["article", "3 packages"];
  if (restLines > 0) parts.push(`${restLines} lines`);
  return (
    <div className="visual-editor w-full">
      <div className="vis-preamble-card">
        <button
          type="button"
          className="vis-preamble-bar"
          title="Show or hide the remaining preamble source"
          onClick={() => setExpanded((open) => !open)}
        >
          Preamble{parts.length > 0 ? ` — ${parts.join(" · ")}` : ""}
          <span className={cn("vis-preamble-chevron", expanded && "open")}>
            ▸
          </span>
        </button>
        <div className="vis-preamble-meta">
          <div className="vis-preamble-meta-title">
            <InplacePill label="Title" initial="A polemic on style" large />
          </div>
          <div className="vis-preamble-meta-row">
            <InplacePill
              label="Author"
              initial="J.~Smith"
              icon={<UserIcon className="vis-title-icon" />}
            />
            <InplacePill
              label="Date"
              initial="2026-10-04"
              icon={<CalendarIcon className="vis-title-icon" />}
              date
            />
          </div>
        </div>
        {expanded && <pre className="vis-raw-src vis-preamble-rest">{rest}</pre>}
      </div>
    </div>
  );
}

/**
 * The preamble card's in-place edit pill, as a React demo: the text
 * variant reads as plain text until hovered (the title), the chip
 * variant has a background and an icon (author, date). Click to
 * edit — the icon and the pill's chrome stay put and only the text
 * becomes an input, so nothing shifts. Enter commits, Escape
 * reverts. The date variant opens the calendar in a popover. The
 * styling is shared with the visual editor's meta pills (the
 * vis-title-* classes).
 */
function InplacePill({
  label,
  initial,
  icon = null,
  large = false,
  date = false,
}: {
  label: string;
  initial: string | null;
  icon?: React.ReactNode;
  large?: boolean;
  date?: boolean;
}) {
  const [value, setValue] = useState<string | null>(initial);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const textRef = useRef<HTMLSpanElement | null>(null);

  // Focus the editable span when editing starts, caret after the text.
  useEffect(() => {
    if (editing && textRef.current !== null) {
      const span = textRef.current;
      span.focus();
      const range = document.createRange();
      range.selectNodeContents(span);
      range.collapse(false);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [editing]);

  const labelSpan = (text: string, empty: boolean) => (
    <span className={cn(empty && "vis-title-pill-empty")}>{text}</span>
  );

  if (date) {
    const picked = value === null ? undefined : new Date(`${value}T00:00:00`);
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="vis-title-pill vis-title-picker"
            title={`${label} — pick a date`}
          >
            {icon}
            {labelSpan(value ?? `Add ${label.toLowerCase()}`, value === null)}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={picked}
            defaultMonth={picked}
            onSelect={(next) => {
              setValue(next === undefined ? null : formatYMD(next));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    );
  }

  // The span itself turns editable: the exact same element in the
  // exact same box, so focusing cannot shift anything.
  const text = editing ? (
    <span
      ref={textRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className={cn(value === null && "vis-title-pill-empty")}
      onInput={(event) =>
        setDraft(event.currentTarget.textContent ?? "")
      }
      onBlur={() => {
        setValue(draft.trim().length > 0 ? draft : null);
        setEditing(false);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.currentTarget.textContent = value ?? "";
          event.currentTarget.blur();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand(
          "insertText",
          false,
          event.clipboardData.getData("text/plain"),
        );
      }}
    >
      {value ?? ""}
    </span>
  ) : (
    <span
      className={cn(value === null && "vis-title-pill-empty")}
    >
      {value ?? `Add ${label.toLowerCase()}`}
    </span>
  );

  return (
    <button
      type="button"
      className={cn("vis-title-pill", large && "vis-title-edit")}
      data-editing={editing ? "true" : undefined}
      title={`${label} — click to edit`}
      onClick={() => {
        // Already editing: the editable span owns the click.
        if (editing) return;
        setDraft(value ?? "");
        setEditing(true);
      }}
    >
      {icon}
      {text}
    </button>
  );
}

export function ComponentGallery({ onClose }: { onClose: () => void }) {
  const [sectionCollapsed, setSectionCollapsed] = useState(false);
  const [face, setFace] = useState<"visual" | "code">("visual");
  const [versionControl, setVersionControl] = useState("git");
  const [autoCompile, setAutoCompile] = useState(true);
  const [formatting, setFormatting] = useState<string>("latexmk");
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(true);
  const [calendarDate, setCalendarDate] = useState<Date | undefined>(
    new Date(),
  );
  const [pickerDate, setPickerDate] = useState<Date | undefined>(
    new Date(2026, 9, 4),
  );

  // Escape closes the gallery, like a dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-sm font-semibold">Component gallery</h1>
        <p className="hidden text-xs text-muted-foreground md:block">
          Every interface component in Polemic, with its variants and states
        </p>
        <div className="ml-auto flex items-center gap-3">
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            Esc
          </kbd>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Close"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 overflow-y-auto p-6">
        <Section
          title="Color tokens"
          note="Semantic tokens — the palette follows the active theme"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {COLOR_TOKENS.map(({ token, role }) => (
              <div
                key={token}
                className="flex flex-col gap-2 rounded-lg border bg-card p-3"
              >
                <div
                  className="size-10 rounded-md border"
                  style={{ backgroundColor: `var(--${token})` }}
                />
                <div>
                  <p className="font-mono text-xs">--{token}</p>
                  <p className="text-xs text-muted-foreground">{role}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography" note="System sans for UI, mono for code">
          <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
            <div>
              <p className="text-2xl font-semibold">Polemic</p>
              <p className="text-xs text-muted-foreground">
                Headings — text-2xl font-semibold
              </p>
            </div>
            <div>
              <p className="text-sm">
                Body copy at the default reading size, with{" "}
                <span className="font-medium">medium weight</span> for emphasis
                inside a sentence.
              </p>
              <p className="text-xs text-muted-foreground">Body — text-sm</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Panels, captions, and quiet labels
              </p>
              <p className="text-xs text-muted-foreground">
                Caption — text-xs muted
              </p>
            </div>
            <div>
              <p className="font-mono text-sm">
                \begin{"{theorem}"} Every prime p satisfies Fermat&rsquo;s
                little theorem. \end{"{theorem}"}
              </p>
              <p className="text-xs text-muted-foreground">
                Code — font-mono text-sm
              </p>
            </div>
          </div>
        </Section>

        <Section title="Badge">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile label="Variants">
              {BUTTON_VARIANTS.map((variant) => (
                <Badge key={variant} variant={variant}>
                  {variant}
                </Badge>
              ))}
            </Tile>
            <Tile label="Pills with icons — cite, ref, label">
              <Badge variant="outline" className="gap-1">
                <QuoteIcon />
                knuth1984
              </Badge>
              <Badge variant="outline" className="gap-1">
                <FileTextIcon />
                thm:fermat
              </Badge>
              <Badge variant="outline" className="gap-1">
                <TagIcon />
                intro
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <CheckIcon />
                3 resolved
              </Badge>
            </Tile>
          </div>
        </Section>

        <Section title="Button" note="Variants across every size">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {BUTTON_VARIANTS.map((variant) => (
              <Tile key={variant} label={variant}>
                {BUTTON_SIZES.map((size) => (
                  <Button key={size} variant={variant} size={size}>
                    {size}
                  </Button>
                ))}
              </Tile>
            ))}
            <Tile label="Icon buttons">
              <Button size="icon-xs">
                <BoldIcon />
              </Button>
              <Button size="icon-sm">
                <ItalicIcon />
              </Button>
              <Button size="icon">
                <TableIcon />
              </Button>
              <Button size="icon-lg">
                <XIcon />
              </Button>
            </Tile>
            <Tile label="States">
              <Button disabled>Disabled</Button>
              <Button variant="outline" aria-invalid>
                Invalid
              </Button>
            </Tile>
          </div>
        </Section>

        <Section title="Button group" note="Joined buttons read as one control">
          <Tile>
            <ButtonGroup>
              <Button variant="outline">Compile</Button>
              <Button variant="outline">Clean</Button>
              <Button variant="outline">Stop</Button>
            </ButtonGroup>
            <ButtonGroup>
              <Button variant="outline" size="icon-sm" title="Bold">
                <BoldIcon />
              </Button>
              <Button variant="outline" size="icon-sm" title="Italic">
                <ItalicIcon />
              </Button>
            </ButtonGroup>
          </Tile>
        </Section>

        <Section
          title="Toggle button"
          note="Single toggles and exclusive groups — click them"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile label="Standalone toggles">
              <ToggleButton
                variant="outline"
                pressed={bold}
                onPressedChange={setBold}
              >
                <BoldIcon />
                Bold
              </ToggleButton>
              <ToggleButton
                variant="outline"
                pressed={italic}
                onPressedChange={setItalic}
              >
                <ItalicIcon />
                Italic
              </ToggleButton>
            </Tile>
            <Tile label="Exclusive group — settings alternatives">
              <ToggleButtonGroup
                type="single"
                value={versionControl}
                onValueChange={(value) => {
                  if (value === "git" || value === "snapshots") {
                    setVersionControl(value);
                  }
                }}
              >
                <ToggleButton value="git" size="sm">
                  Git
                </ToggleButton>
                <ToggleButton value="snapshots" size="sm">
                  Snapshots
                </ToggleButton>
              </ToggleButtonGroup>
            </Tile>
          </div>
        </Section>

        <Section
          title="Tabs"
          note="An exclusive face switch — the window header's Visual/Code control"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile label="Uncontrolled">
              <Tabs defaultValue="visual">
                <TabsList>
                  <TabsTrigger value="visual">Visual</TabsTrigger>
                  <TabsTrigger value="code">Code</TabsTrigger>
                </TabsList>
                <TabsContent
                  value="visual"
                  className="text-xs text-muted-foreground"
                >
                  The rendered or managed form of the file.
                </TabsContent>
                <TabsContent
                  value="code"
                  className="text-xs text-muted-foreground"
                >
                  The raw text of the file.
                </TabsContent>
              </Tabs>
            </Tile>
            <Tile label="Controlled">
              <Tabs
                value={face}
                onValueChange={(value) => {
                  if (value === "visual" || value === "code") setFace(value);
                }}
              >
                <TabsList>
                  <TabsTrigger value="visual">Visual</TabsTrigger>
                  <TabsTrigger value="code">Code</TabsTrigger>
                </TabsList>
                <TabsContent
                  value="visual"
                  className="text-xs text-muted-foreground"
                >
                  Face: {face}
                </TabsContent>
                <TabsContent
                  value="code"
                  className="text-xs text-muted-foreground"
                >
                  Face: {face}
                </TabsContent>
              </Tabs>
            </Tile>
          </div>
        </Section>

        <Section title="Text inputs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile label="Input">
              <Input placeholder="Search in project…" />
              <Input defaultValue="chapter-1.tex" aria-invalid />
              <Input placeholder="Disabled" disabled />
            </Tile>
            <Tile label="Textarea">
              <Textarea
                placeholder="An abstract for the document…"
                rows={3}
                className="w-full"
              />
            </Tile>
          </div>
        </Section>

        <Section title="Switch">
          <Tile>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={autoCompile} onCheckedChange={setAutoCompile} />
              Auto-compile on save
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={false} />
              Off
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked disabled />
              <Switch disabled />
              Disabled
            </label>
          </Tile>
        </Section>

        <Section title="Select">
          <Tile label="Single-choice settings with more than three options">
            <Select value={formatting} onValueChange={setFormatting}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latexmk">latexmk</SelectItem>
                <SelectItem value="pdflatex">pdflatex</SelectItem>
                <SelectItem value="xelatex">xelatex</SelectItem>
                <SelectItem value="lualatex">lualatex</SelectItem>
              </SelectContent>
            </Select>
          </Tile>
        </Section>

        <Section
          title="Calendar and date picker"
          note="react-day-picker under the shadcn skin"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile label="Calendar — single select">
              <Calendar
                mode="single"
                selected={calendarDate}
                onSelect={setCalendarDate}
              />
            </Tile>
            <Tile label="Date picker — popover + calendar">
              <DatePicker value={pickerDate} onValueChange={setPickerDate} />
              <DatePicker
                value={undefined}
                onValueChange={setPickerDate}
                placeholder="Pick a date"
              />
              <p className="w-full text-xs text-muted-foreground">
                Picked:{" "}
                {pickerDate === undefined
                  ? "none"
                  : pickerDate.toLocaleDateString()}
              </p>
            </Tile>
          </div>
        </Section>

        <Section title="Dropdown menu">
          <Tile>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Insert</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Sectioning</DropdownMenuLabel>
                <DropdownMenuItem>
                  Section
                  <DropdownMenuShortcut>⌘⇧S</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>Subsection</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  Table…
                  <DropdownMenuShortcut>⌘⇧T</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>Figure from image…</DropdownMenuItem>
                <DropdownMenuItem>TikZ Picture…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tile>
        </Section>

        <Section title="Dialog">
          <Tile>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open sample dialog</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Sample dialog</DialogTitle>
                  <DialogDescription>
                    The dialog shell: header, description, and footer. Escape
                    closes it — and bubbles to the gallery too.
                  </DialogDescription>
                </DialogHeader>
                <p className="text-sm">
                  Dialogs hold focused, one-off work that should not get its
                  own panel.
                </p>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button>Save changes</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Tile>
        </Section>

        <Section title="Separator and scroll area">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile label="Separator">
              <div className="flex w-full flex-col gap-3">
                <p className="text-xs text-muted-foreground">Above</p>
                <Separator />
                <p className="text-xs text-muted-foreground">Below</p>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm">
                    One
                  </Button>
                  <Separator orientation="vertical" className="h-4" />
                  <Button variant="outline" size="sm">
                    Two
                  </Button>
                </div>
              </div>
            </Tile>
            <Tile label="Scroll area">
              <ScrollArea className="h-32 w-full rounded-md border">
                <div className="flex flex-col gap-1 p-2 text-xs">
                  {[
                    "main.tex",
                    "chapters/introduction.tex",
                    "chapters/method.tex",
                    "chapters/results.tex",
                    "chapters/discussion.tex",
                    "bibliography.bib",
                    "figures/diagram.tikz",
                    "assets/plot.pdf",
                  ].map((name) => (
                    <p key={name} className="font-mono">
                      {name}
                    </p>
                  ))}
                </div>
              </ScrollArea>
            </Tile>
          </div>
        </Section>

        <Section
          title="App patterns"
          note="Composed from the primitives above"
        >
          <div className="flex flex-col gap-3">
            <Tile label="Inline edit pills — preamble metadata (click to edit)">
              <div className="flex w-full flex-col items-center gap-3">
                <div className="flex w-full justify-center">
                  <InplacePill label="Title" initial="A polemic on style" large />
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <InplacePill
                    label="Author"
                    initial="J.~Smith"
                    icon={<UserIcon className="vis-title-icon" />}
                  />
                  <InplacePill
                    label="Date"
                    initial="2026-10-04"
                    icon={<CalendarIcon className="vis-title-icon" />}
                    date
                  />
                  <InplacePill
                    label="Date"
                    initial={null}
                    icon={<CalendarIcon className="vis-title-icon" />}
                    date
                  />
                </div>
              </div>
            </Tile>
            <Tile label="Preamble card — summary bar, metadata pills, collapsed source">
              <PreambleCardDemo />
            </Tile>
            <Tile label="Panel section header — collapse chevron, action badges">
              <div className="w-full rounded-md border">
                <SectionHeader
                  label="Outline"
                  collapsed={sectionCollapsed}
                  onToggle={() => setSectionCollapsed((c) => !c)}
                  actions={
                    <>
                      <Badge variant="secondary">12</Badge>
                      <Badge variant="outline">3 figures</Badge>
                    </>
                  }
                />
                {!sectionCollapsed && (
                  <div className="flex flex-col gap-1 px-3 pb-3 text-xs text-muted-foreground">
                    <p>1 Introduction</p>
                    <p>2 Method</p>
                    <p>3 Results</p>
                  </div>
                )}
              </div>
            </Tile>
            <Tile label="Settings row — description and control">
              <div className="flex w-full items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Version control</p>
                  <p className="text-xs text-muted-foreground">
                    git when it is installed, snapshots otherwise
                  </p>
                </div>
                <ToggleButtonGroup
                  type="single"
                  value={versionControl}
                  onValueChange={(value) => {
                    if (value === "git" || value === "snapshots") {
                      setVersionControl(value);
                    }
                  }}
                >
                  <ToggleButton value="git" size="sm">
                    Git
                  </ToggleButton>
                  <ToggleButton value="snapshots" size="sm">
                    Snapshots
                  </ToggleButton>
                </ToggleButtonGroup>
              </div>
              <Separator />
              <div className="flex w-full items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Auto-compile</p>
                  <p className="text-xs text-muted-foreground">
                    Rebuild the PDF whenever a file is saved
                  </p>
                </div>
                <Switch
                  checked={autoCompile}
                  onCheckedChange={setAutoCompile}
                />
              </div>
            </Tile>
          </div>
        </Section>

        <p className="pb-4 text-xs text-muted-foreground">
          Opened from the Develop menu; available in dev builds only.
        </p>
      </div>
    </div>
  );
}
