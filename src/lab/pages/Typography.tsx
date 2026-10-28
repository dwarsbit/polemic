import { Check, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { LabSection } from "@/lab/Lab";
import { cn } from "@/lib/utils";

/**
 * Typography: what the app uses today (an audit of the size, weight
 * and color classes across src/components) and the proposed set of
 * text roles. Every role is one combination of size, weight and color;
 * components pick a role instead of composing their own.
 */

const AUDIT = {
  sizes: [
    ["text-xs (12px)", 262],
    ["text-sm (14px)", 86],
    ["text-[10px]", 49],
    ["text-[11px]", 28],
    ["text-base (16px)", 5],
    ["text-lg", 2],
    ["text-2xl", 2],
    ["text-[9px]", 1],
  ],
  weights: [
    ["font-medium", 68],
    ["font-semibold", 6],
    ["font-normal", 4],
  ],
  colors: [
    ["text-muted-foreground", 301],
    ["text-foreground", 51],
    ["text-destructive", 47],
    ["text-accent-foreground", 17],
    ["text-amber-600 / -400", 32],
    ["text-primary", 8],
    ["text-emerald-600 / -400 / -700 / -300", 10],
    ["text-green-600", 3],
    ["text-amber-500 / -700", 5],
    ["text-sky-600 / -400", 2],
    ["text-orange-500 / -400", 2],
  ],
} as const;

interface Role {
  name: string;
  classes: string;
  where: string;
  sample: string;
  replaces?: string;
}

const ROLES: Role[] = [
  {
    name: "Page title",
    classes: "text-lg font-semibold",
    where: "Projects screen, full-page views.",
    sample: "Projects",
    replaces: "text-2xl, text-lg mixed",
  },
  {
    name: "Dialog title",
    classes: "text-base font-semibold",
    where: "DialogTitle (settings, packages, imports).",
    sample: "Document settings",
  },
  {
    name: "Card title",
    classes: "text-sm font-medium",
    where: "Section cards in settings and dialogs.",
    sample: "Math input",
    replaces: "text-xs font-medium text-muted-foreground",
  },
  {
    name: "Panel title",
    classes: "text-xs font-medium",
    where: "Navigator, properties, preview and issues headers.",
    sample: "Figures & tables",
    replaces: "ALL CAPS text-xs font-medium text-muted-foreground",
  },
  {
    name: "Body",
    classes: "text-sm",
    where: "Dialogs, settings rows, projects screen, forms.",
    sample: "Files created in the Files panel are added to the main document.",
  },
  {
    name: "Dense UI",
    classes: "text-xs",
    where: "Panel lists, tabs, toolbar, tree rows, menus inside panels.",
    sample: "chapters/introduction.tex",
  },
  {
    name: "Description",
    classes: "text-xs text-muted-foreground",
    where: "Help text under a setting, hints, empty states.",
    sample: "Right-click a marked word for corrections.",
  },
  {
    name: "Meta",
    classes: "text-2xs text-muted-foreground tabular-nums",
    where: "Counts, line numbers, dates and paths beside list rows; the status bar.",
    sample: "12 · main.tex:48 · 2 min ago",
    replaces: "text-[9px], text-[10px], text-[11px] (78 uses)",
  },
  {
    name: "Group label",
    classes: "text-2xs font-medium uppercase tracking-wide text-muted-foreground",
    where: "Command palette groups, dropdown section labels. Nowhere else.",
    sample: "Recent files",
  },
  {
    name: "Code",
    classes: "font-mono text-xs",
    where: "Paths, keys, commit hashes, LaTeX snippets in the UI.",
    sample: "\\includegraphics[width=0.8\\linewidth]{fig}",
  },
];

function Swatch({
  name,
  className,
  text,
}: {
  name: string;
  className: string;
  text?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <span className={cn("size-6 shrink-0 rounded-md border", className)} />
      <div className="min-w-0">
        <p className="text-xs font-medium">{name}</p>
        <p className="truncate font-mono text-2xs text-muted-foreground">
          {text ?? className}
        </p>
      </div>
    </div>
  );
}

function Pill({ warn, children }: { warn?: boolean; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 font-mono text-2xs leading-4",
        warn
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-tint-edge bg-tint-soft text-tint-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function TypographyPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Typography and color roles</h1>
      <p className="mb-8 max-w-2xl text-sm text-muted-foreground">
        The app composes text from 8 sizes, 3 weights and 11 color classes case by case.
        The proposal is a short list of named roles, one combination each, and a single
        small size (11px) for meta text.
      </p>

      <LabSection
        title="Today"
        note="Class usage across src/components. Three ad-hoc pixel sizes and six status hues stand out."
      >
        <div className="grid grid-cols-3 gap-4">
          {(["sizes", "weights", "colors"] as const).map((group) => (
            <div key={group} className="rounded-xl border bg-card p-3">
              <p className="mb-2 text-xs font-medium capitalize">{group}</p>
              <ul className="space-y-1">
                {AUDIT[group].map(([cls, count]) => (
                  <li key={cls} className="flex justify-between gap-2 text-xs">
                    <span className="truncate font-mono">{cls}</span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </LabSection>

      <LabSection
        title="Proposed text roles"
        note="Foreground for primary text, muted-foreground for secondary, never a third gray. Medium weight marks labels and the active item; semibold is for titles only."
      >
        <div className="overflow-hidden rounded-xl border bg-card">
          {ROLES.map((role, index) => (
            <div
              key={role.name}
              className={cn(
                "grid grid-cols-[140px_1fr_1.2fr] items-center gap-4 px-4 py-3",
                index > 0 && "border-t",
              )}
            >
              <div>
                <p className="text-xs font-medium">{role.name}</p>
                <p className="text-2xs text-muted-foreground">{role.where}</p>
              </div>
              <span className={cn("truncate", role.classes)}>{role.sample}</span>
              <div className="min-w-0">
                <p className="truncate font-mono text-2xs">{role.classes}</p>
                {role.replaces && (
                  <p className="truncate text-2xs text-muted-foreground">
                    replaces {role.replaces}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </LabSection>

      <LabSection
        title="Color roles"
        note="The mist gray scale carries all surfaces and text. Violet is the only tint: focus rings, text selection, selected rows and pills. One hue per status meaning, as tokens, so panels stop mixing amber-400/500/600/700 and orange."
      >
        <div className="grid grid-cols-4 gap-3">
          <Swatch name="Foreground" className="bg-foreground" />
          <Swatch name="Muted foreground" className="bg-muted-foreground" />
          <Swatch name="Border" className="bg-border" />
          <Swatch name="Muted / accent" className="bg-muted" />
          <Swatch name="Tint" className="bg-tint" text="violet-500 · ring, selection" />
          <Swatch
            name="Tint soft"
            className="bg-tint-soft"
            text="violet 10% · pills, selected rows"
          />
          <Swatch name="Success" className="bg-success" text="emerald-600 / 400" />
          <Swatch name="Warning" className="bg-warning" text="amber-600 / 400" />
          <Swatch name="Destructive" className="bg-destructive" text="red-600 / 400" />
          <Swatch name="Info" className="bg-info" text="sky-600 / 400" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border bg-card px-4 py-3 text-xs">
          <span className="flex items-center gap-1 text-success">
            <Check className="size-3.5" /> Compiled
          </span>
          <span className="flex items-center gap-1 text-warning">
            <TriangleAlert className="size-3.5" /> 3 warnings
          </span>
          <span className="flex items-center gap-1 text-destructive">
            <CircleAlert className="size-3.5" /> 2 errors
          </span>
          <span className="flex items-center gap-1 text-info">
            <Info className="size-3.5" /> Hint
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Pill>fig:results</Pill>
            <Pill>smith2024</Pill>
            <Pill warn>sec:missing</Pill>
          </span>
          <span
            className="rounded-md px-2 py-1"
            style={{ background: "var(--selection)" }}
          >
            selected text
          </span>
          <button
            type="button"
            className="rounded-md border px-2 py-1 ring-3 ring-ring/30 border-ring"
          >
            focused control
          </button>
        </div>
      </LabSection>

      <LabSection title="Mist scale" note="Tailwind's mist, 50 to 950.">
        <div className="grid grid-cols-11 gap-1">
          {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => (
            <div key={step} className="flex flex-col items-center gap-1">
              <div
                className="h-10 w-full rounded-md border"
                style={{ background: `var(--color-mist-${step})` }}
              />
              <span className="text-2xs text-muted-foreground">{step}</span>
            </div>
          ))}
        </div>
      </LabSection>
    </>
  );
}
