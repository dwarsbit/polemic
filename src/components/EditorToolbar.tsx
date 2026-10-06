import { useMemo, useState } from "react";
import { Bold, ChevronDown, Image, Italic, List, ListOrdered, Plus, TableProperties, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { NewTheoremDialog } from "@/components/NewTheoremDialog";
import { wrapFigure } from "@/lib/editor-figure";
import {
  FIGURE_SCAFFOLD,
  TABLE_SCAFFOLD,
  insertAtCursor,
} from "@/lib/editor-insert";
import { applyEditsInView } from "@/lib/editor-edits";
import { ensurePackages } from "@/lib/editor-figure";
import { applyTextWrapper } from "@/lib/editor-wrappers";
import { THEOREM_ENVS, newtheoremDeclarations } from "@/lib/visual/parse";
import { useDialogsStore } from "@/store/dialogs";
import { useEditorStore } from "@/store/editor";

/** A list skeleton with the caret right after the first \item. */
function listSkeleton(kind: "itemize" | "enumerate") {
  const text = `\\begin{${kind}}\n  \\item \n\\end{${kind}}`;
  return { text, cursorOffset: text.length - `\\end{${kind}}`.length - 1 };
}

/** An environment skeleton with the caret on the body line. */
function envSkeleton(env: string) {
  const text = `\\begin{${env}}\n  \n\\end{${env}}`;
  return { text, cursorOffset: text.indexOf("\n") + 3 };
}

/**
 * The strip below the tabs bar: the Insert menu on the left, insert
 * actions and text formatting on the right. All buttons act on the
 * editor cursor or selection and hand focus back to it.
 */
export function EditorToolbar() {
  const itemize = listSkeleton("itemize");
  const enumerate = listSkeleton("enumerate");
  const content = useEditorStore((s) => s.content);
  // \newtheorem-declared envs join the theorem section, live.
  const declared = useMemo(() => {
    const cut = content.indexOf("\\begin{document}");
    return cut === -1 ? [] : newtheoremDeclarations(content.slice(0, cut));
  }, [content]);

  const [theoremOpen, setTheoremOpen] = useState(false);

  function commitNewtheorem(
    env: string,
    display: string,
    insertInstance: boolean,
  ): string | null {
    const name = display.length > 0 ? display : env.charAt(0).toUpperCase() + env.slice(1);
    const contentNow = useEditorStore.getState().content;
    const beginAt = contentNow.indexOf("\\begin{document}");
    if (beginAt === -1) {
      return "The file has no preamble: no \\begin{document} to declare before.";
    }
    ensurePackages(["amsthm"]);
    // The package line may have shifted positions; re-read the doc.
    const after = useEditorStore.getState().content;
    const beginAfter = after.indexOf("\\begin{document}");
    const lineStart = after.lastIndexOf("\n", beginAfter) + 1;
    const changed = applyEditsInView([
      { from: lineStart, to: lineStart, insert: `\\newtheorem{${env}}{${name}}\n` },
    ]);
    if (!changed) return "The declaration needs the Code face with an open .tex file.";
    if (insertInstance) {
      const skeleton = envSkeleton(env);
      insertAtCursor(skeleton.text, skeleton.cursorOffset);
    }
    return null;
  }

  const theoremEntries = [
    ...[...THEOREM_ENVS].map((env) => ({
      env,
      label: env.charAt(0).toUpperCase() + env.slice(1),
    })),
    ...declared
      .filter((d) => !THEOREM_ENVS.has(d.env))
      .map((d) => ({ env: d.env, label: d.name.length > 0 ? d.name : d.env })),
  ];

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
            <Plus className="size-3.5" />
            Insert
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[28rem] overflow-y-auto">
          <DropdownMenuLabel>Environments</DropdownMenuLabel>
          {["quote", "quotation", "center", "abstract"].map((env) => {
            const skeleton = envSkeleton(env);
            return (
              <DropdownMenuItem
                key={env}
                onSelect={() =>
                  insertAtCursor(skeleton.text, skeleton.cursorOffset)
                }
              >
                {env.charAt(0).toUpperCase() + env.slice(1)}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Theorem environments</DropdownMenuLabel>
          {theoremEntries.map((entry) => {
            const skeleton = envSkeleton(entry.env);
            return (
              <DropdownMenuItem
                key={entry.env}
                onSelect={() => {
                  ensurePackages(["amsthm"]);
                  insertAtCursor(skeleton.text, skeleton.cursorOffset);
                }}
              >
                {entry.label}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Inline &amp; floats</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => insertAtCursor("\\footnote{}", 11)}>
            Footnote — \footnote
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => insertAtCursor("\\[\n  \n\\]", "\\[\n  ".length)}
          >
            Display math — \[…\]
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => insertAtCursor(FIGURE_SCAFFOLD, FIGURE_SCAFFOLD.indexOf("{}") + 1)}
          >
            Figure
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => insertAtCursor(TABLE_SCAFFOLD, TABLE_SCAFFOLD.indexOf("a & b"))}
          >
            Table
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setTheoremOpen(true)}>
            New theorem environment…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewTheoremDialog
        open={theoremOpen}
        onOpenChange={setTheoremOpen}
        existingEnvs={[
          ...THEOREM_ENVS,
          ...declared.map((d) => d.env),
        ]}
        onCommit={commitNewtheorem}
      />
      <Separator orientation="vertical" className="h-5" />
      <ButtonGroup>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Insert table (Cmd/Ctrl + Shift + T)"
          onClick={() => useDialogsStore.getState().setTableDialogOpen(true)}
        >
          <TableProperties className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Wrap in figure (Cmd/Ctrl + Alt + G)"
          onClick={() => wrapFigure()}
        >
          <Image className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Bulleted list (itemize)"
          onClick={() => insertAtCursor(itemize.text, itemize.cursorOffset)}
        >
          <List className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Numbered list (enumerate)"
          onClick={() => insertAtCursor(enumerate.text, enumerate.cursorOffset)}
        >
          <ListOrdered className="size-4" />
        </Button>
      </ButtonGroup>
      <Separator orientation="vertical" className="h-5" />
      <ButtonGroup>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Bold — \\textbf (Cmd/Ctrl + B)"
          onClick={() => applyTextWrapper("bold")}
        >
          <Bold className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Emphasis — \\emph (Cmd/Ctrl + I)"
          onClick={() => applyTextWrapper("emph")}
        >
          <Italic className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Underline — \\underline (Cmd/Ctrl + U)"
          onClick={() => applyTextWrapper("underline")}
        >
          <Underline className="size-4" />
        </Button>
      </ButtonGroup>
    </div>
  );
}
