import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Camera,
  Code2,
  FileCheck2,
  HardDrive,
  Images,
  MessageSquare,
  ScanText,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { AppPreview } from "@/components/landing/app-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { githubUrl } from "@/lib/shared";

const FEATURES = [
  {
    icon: Code2,
    title: "Code and visual editing",
    description:
      "Write LaTeX with completion and environment pairing, or switch to a visual face that renders headings, math and citations.",
    href: "/docs/writing/code-editor",
  },
  {
    icon: ScanText,
    title: "Live PDF with SyncTeX",
    description:
      "Save to compile. Cmd/Ctrl-click in the source to find it in the PDF, and back again.",
    href: "/docs/compile-and-preview",
  },
  {
    icon: BookOpen,
    title: "BibTeX and Zotero",
    description:
      "Browse and edit .bib entries, spot unused or undefined keys, and pull references from Zotero.",
    href: "/docs/bibliography",
  },
  {
    icon: Images,
    title: "Assets panel",
    description:
      "A thumbnail grid of your figures. Drag one into the editor for a ready \\includegraphics.",
    href: "/docs/assets",
  },
  {
    icon: MessageSquare,
    title: "Comments",
    description:
      "Review notes in six categories, kept beside your source instead of inside it.",
    href: "/docs/comments",
  },
  {
    icon: Camera,
    title: "Snapshots and git",
    description:
      "Take a snapshot before a big change, or stage, diff and commit without a terminal.",
    href: "/docs/snapshots-and-git",
  },
  {
    icon: FileCheck2,
    title: "One-click fixes",
    description:
      "Common compile errors come with a fix: typos in commands, missing packages, stray math.",
    href: "/docs/compile-and-preview#issues-and-quick-fixes",
  },
  {
    icon: Sparkles,
    title: "Optional AI quickfix",
    description:
      "For the rest, ask any OpenAI-compatible model, local ones included. You review the diff.",
    href: "/docs/ai-quickfix",
  },
];

const PRINCIPLES = [
  {
    icon: HardDrive,
    title: "Your files",
    description:
      "A project is a plain folder. Open it in any other editor, sync it, put it in git.",
  },
  {
    icon: WifiOff,
    title: "Your machine",
    description:
      "Compiles run on your computer with your TeX distribution. No account, no upload, no queue.",
  },
  {
    icon: ShieldCheck,
    title: "Safe to open",
    description:
      "Project-level latexmkrc files and git hooks never run, so shared projects are safe to compile.",
  },
];

const STEPS = [
  {
    title: "Install a TeX distribution",
    body: "TeX Live, MacTeX or MiKTeX, with latexmk on your PATH.",
    code: "latexmk --version",
  },
  {
    title: "Build Polemic",
    body: "Clone the repository and start the app with pnpm.",
    code: "pnpm install && pnpm tauri dev",
  },
  {
    title: "Start writing",
    body: "Pick a template (article, report, slides or thesis) and press Cmd/Ctrl + S.",
    code: "⌘S  →  build/main.pdf",
  },
];

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-medium text-brand-via">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-muted-foreground text-pretty">{description}</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 -z-10 mx-auto h-[480px] max-w-4xl rounded-full bg-gradient-to-r from-brand-from via-brand-via to-brand-to opacity-15 blur-3xl dark:opacity-25"
        />
        <div className="mx-auto max-w-6xl px-4 pt-20 pb-16 text-center sm:pt-28">
          <Badge variant="outline" className="mb-6 bg-background/60 backdrop-blur">
            Pre-alpha · Open source · MIT
          </Badge>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            The{" "}
            <span className="bg-gradient-to-r from-brand-from via-brand-via to-brand-to bg-clip-text text-transparent">
              local-first
            </span>{" "}
            LaTeX editor
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground text-pretty">
            Write LaTeX with a code editor and a live PDF preview, compiled on your own
            machine with your own TeX distribution. A lightweight desktop alternative to
            Overleaf.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/docs/installation">
                Get started <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={githubUrl} target="_blank" rel="noreferrer">
                View on GitHub
              </a>
            </Button>
          </div>
          <div className="mt-16 text-left">
            <AppPreview />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <SectionHeading
            eyebrow="Features"
            title="Everything for the write, compile, revise loop"
            description="The tools you reach for while writing a paper or thesis, in one window."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <Link key={f.title} href={f.href} className="group">
                <Card className="h-full gap-3 transition-colors group-hover:border-brand-via/40">
                  <CardHeader>
                    <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-brand-via/10 text-brand-via">
                      <f.icon className="size-5" />
                    </div>
                    <CardTitle>{f.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="leading-relaxed">
                      {f.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Local-first */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-4">
          <SectionHeading
            eyebrow="Local-first"
            title="Your writing stays yours"
            description="Polemic does its work on your computer. The network is only used for the features you turn on."
          />
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="text-center">
                <div className="mx-auto flex size-11 items-center justify-center rounded-full border bg-card shadow-sm">
                  <p.icon className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground text-pretty">
                  {p.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Get started */}
      <section className="border-t bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <SectionHeading
            eyebrow="Get started"
            title="Up and running in three steps"
            description="Polemic is pre-alpha, so for now you build it from source."
          />
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <Card className="h-full gap-4">
                  <CardHeader>
                    <span className="mb-1 font-mono text-sm text-brand-via">
                      0{i + 1}
                    </span>
                    <CardTitle>{s.title}</CardTitle>
                    <CardDescription>{s.body}</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto">
                    <code className="block overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {s.code}
                    </code>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
          <div className="mt-10 text-center">
            <Button asChild variant="outline">
              <Link href="/docs/installation">
                Read the installation guide <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
          <p>Polemic · MIT license</p>
          <nav className="flex gap-6">
            <Link href="/docs" className="hover:text-foreground">
              Docs
            </Link>
            <a
              href={`${githubUrl}/blob/main/ROADMAP.md`}
              className="hover:text-foreground"
            >
              Roadmap
            </a>
            <a href={githubUrl} className="hover:text-foreground">
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
