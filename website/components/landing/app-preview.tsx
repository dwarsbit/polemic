import type { ReactNode } from "react";
import { BookOpen, FileText, Folder, Image as ImageIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * A drawn mock of the editor window: file tree, the Code/Visual faces
 * of the editor, and the PDF preview. Not a screenshot, so it follows
 * the site's theme.
 */

const FILES = [
  { name: "main.tex", icon: FileText, active: true },
  { name: "intro.tex", icon: FileText },
  { name: "references.bib", icon: BookOpen },
  { name: "assets", icon: Folder },
  { name: "figure-1.pdf", icon: ImageIcon, nested: true },
];

// Each line is a list of [text, token class] pairs.
const SOURCE: [string, string?][][] = [
  [["\\section", "text-brand-via"], ["{Introduction}"]],
  [
    ["\\label", "text-brand-via"],
    ["{sec:intro}", "text-muted-foreground"],
  ],
  [],
  [["Local-first tools keep your writing on your own machine "]],
  [["("], ["\\cite", "text-brand-via"], ["{kleppmann2019}", "text-brand-to"], [")."]],
  [["The energy of a body at rest is"]],
  [],
  [
    ["\\begin", "text-brand-via"],
    ["{equation}", "text-muted-foreground"],
  ],
  [["  E = mc^2", "text-brand-from"]],
  [
    ["\\end", "text-brand-via"],
    ["{equation}", "text-muted-foreground"],
  ],
  [],
  [
    ["See Section~"],
    ["\\ref", "text-brand-via"],
    ["{sec:method}", "text-brand-to"],
    ["."],
  ],
];

function CodeFace() {
  return (
    <pre className="overflow-hidden font-mono text-[12px] leading-6">
      {SOURCE.map((line, i) => (
        <div key={i} className="flex">
          <span className="w-8 shrink-0 pr-3 text-right text-muted-foreground/50 select-none">
            {i + 1}
          </span>
          <code className="whitespace-pre">
            {line.map(([text, cls], j) => (
              <span key={j} className={cls}>
                {text}
              </span>
            ))}
          </code>
        </div>
      ))}
    </pre>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="mx-0.5 rounded-sm border border-brand-via/30 bg-brand-via/10 px-1 py-px font-mono text-[11px] text-brand-via">
      {children}
    </span>
  );
}

function VisualFace() {
  return (
    <div className="space-y-3 px-4 text-[13px] leading-6">
      <h3 className="text-base font-semibold">1 Introduction</h3>
      <p>
        Local-first tools keep your writing on your own machine{" "}
        <Pill>kleppmann2019</Pill>. The energy of a body at rest is
      </p>
      <p className="text-center font-serif text-[15px] italic">
        E = mc<sup>2</sup>
      </p>
      <p>
        See Section <Pill>sec:method</Pill>.
      </p>
    </div>
  );
}

function PdfPage() {
  return (
    <div className="mx-auto aspect-[1/1.3] w-full max-w-[300px] rounded-sm bg-white p-6 font-serif text-[9px] leading-[1.45] text-neutral-900 shadow-md ring-1 ring-black/5">
      <p className="text-center text-[13px]">On Writing Locally</p>
      <p className="mt-1 text-center text-[8px] text-neutral-600">
        A. Author · October 2026
      </p>
      <p className="mt-4 text-[10px] font-bold">1&nbsp;&nbsp;Introduction</p>
      <p className="mt-1 text-justify">
        Local-first tools keep your writing on your own machine (Kleppmann et al.,
        2019). The energy of a body at rest is
      </p>
      <p className="my-2 flex justify-between italic">
        <span />
        <span>
          E = mc<sup>2</sup>
        </span>
        <span className="not-italic">(1)</span>
      </p>
      <p className="text-justify">See Section 2.</p>
      <p className="mt-3 text-[10px] font-bold">2&nbsp;&nbsp;Method</p>
      <div className="mt-1 space-y-1">
        {[100, 96, 100, 88, 100, 70].map((w, i) => (
          <div
            key={i}
            className="h-[5px] rounded-full bg-neutral-200"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function AppPreview() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-2xl shadow-brand-via/10">
      <div className="flex h-9 items-center gap-1.5 border-b bg-muted/50 px-3">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 truncate text-xs text-muted-foreground">
          thesis — main.tex
        </span>
      </div>
      <Tabs defaultValue="code" className="gap-0">
        <div className="grid md:grid-cols-[170px_1fr_1fr] sm:grid-cols-2">
          <aside className="hidden border-r p-2 md:block">
            {FILES.map((f) => (
              <div
                key={f.name}
                className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                  f.nested ? "pl-6" : ""
                } ${f.active ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
              >
                <f.icon className="size-3.5" />
                {f.name}
              </div>
            ))}
          </aside>
          <div className="min-w-0 border-r py-3">
            <div className="mb-3 px-4">
              <TabsList>
                <TabsTrigger value="code">Code</TabsTrigger>
                <TabsTrigger value="visual">Visual</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="code">
              <CodeFace />
            </TabsContent>
            <TabsContent value="visual">
              <VisualFace />
            </TabsContent>
          </div>
          <div className="hidden bg-muted/40 p-6 sm:block">
            <PdfPage />
          </div>
        </div>
      </Tabs>
    </div>
  );
}
