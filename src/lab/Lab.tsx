import { useEffect, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { TypographyPage } from "@/lab/pages/Typography";
import { SHELL_NOTES, ShellPage } from "@/lab/pages/Shell";
import { SETTINGS_NOTES, SettingsPage } from "@/lab/pages/Settings";
import { MenuPage } from "@/lab/pages/Menu";
import { CopyPage } from "@/lab/pages/Copy";

/**
 * The Design Lab: dev-only prototypes, one page per area, built from
 * the app's own shadcn components on mock data. Open with `?lab` (or
 * `?lab=shell` etc.) under `pnpm dev`. The toolbar flips light and dark.
 * The designs are merged into the app; the lab stays as the reference
 * for the typography roles, the menu structure and the copy guide.
 */

const PAGES: {
  id: string;
  label: string;
  render: () => ReactNode;
  /** Full-height page without the reading column. */
  bleed?: boolean;
  /** What changed against the shipped UI, shown from the toolbar. */
  notes?: string[];
}[] = [
  { id: "typography", label: "Typography", render: () => <TypographyPage /> },
  {
    id: "shell",
    label: "Shell",
    render: () => <ShellPage />,
    bleed: true,
    notes: SHELL_NOTES,
  },
  {
    id: "settings",
    label: "Settings",
    render: () => <SettingsPage />,
    bleed: true,
    notes: SETTINGS_NOTES,
  },
  { id: "menu", label: "Menus", render: () => <MenuPage /> },
  { id: "copy", label: "Copy", render: () => <CopyPage /> },
];

function readPage(): string {
  const value = new URLSearchParams(location.search).get("lab");
  return PAGES.some((p) => p.id === value) ? (value as string) : PAGES[0].id;
}

function readFlag(key: string, fallback: boolean): boolean {
  const value = new URLSearchParams(location.search).get(key);
  return value === null ? fallback : value !== "0";
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center rounded-lg bg-accent/60 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
            value === option.id
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Lab() {
  const [page, setPage] = useState(readPage);
  const [dark, setDark] = useState(() => readFlag("dark", false));

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("lab");
    root.classList.toggle("dark", dark);
    const params = new URLSearchParams(location.search);
    params.set("lab", page);
    params.set("dark", dark ? "1" : "0");
    history.replaceState(null, "", `?${params}`);
  }, [page, dark]);

  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-3">
        <span className="text-xs font-semibold">Design Lab</span>
        <nav className="flex items-center gap-0.5">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cn(
                "rounded-md px-2 py-1 text-xs transition-colors",
                page === p.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setPage(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {current.notes && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="xs" className="gap-1">
                  <CircleHelp className="size-3" /> What changed
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[440px] text-xs">
                <ol className="list-decimal space-y-2 pl-4">
                  {current.notes.map((note) => (
                    <li key={note} className="text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {note.slice(0, note.indexOf(":") + 1)}
                      </span>
                      {note.slice(note.indexOf(":") + 1)}
                    </li>
                  ))}
                </ol>
              </PopoverContent>
            </Popover>
          )}
          <Segmented
            value={dark ? "dark" : "light"}
            options={[
              { id: "light", label: "Light" },
              { id: "dark", label: "Dark" },
            ]}
            onChange={(v) => setDark(v === "dark")}
          />
        </div>
      </div>
      <div
        className={cn(
          "min-h-0 flex-1",
          current.bleed ? "flex flex-col" : "overflow-y-auto",
        )}
      >
        {current.bleed ? (
          current.render()
        ) : (
          <div className="mx-auto w-full max-w-5xl px-6 py-8">{current.render()}</div>
        )}
      </div>
    </div>
  );
}

/** A lab page section: title, note, body. */
export function LabSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-base font-semibold">{title}</h2>
      {note && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
