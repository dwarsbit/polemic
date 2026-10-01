import { Bold, Image, Italic, List, ListOrdered, TableProperties, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Separator } from "@/components/ui/separator";
import { wrapFigure } from "@/lib/editor-figure";
import { insertAtCursor } from "@/lib/editor-insert";
import { applyTextWrapper } from "@/lib/editor-wrappers";
import { useDialogsStore } from "@/store/dialogs";

/** A list skeleton with the caret right after the first \item. */
function listSkeleton(kind: "itemize" | "enumerate") {
  const text = `\\begin{${kind}}\n  \\item \n\\end{${kind}}`;
  return { text, cursorOffset: text.length - `\\end{${kind}}`.length - 1 };
}

/**
 * The strip below the tabs bar: insert actions on the left, text
 * formatting on the right. All buttons act on the editor cursor or
 * selection and hand focus back to it.
 */
export function EditorToolbar() {
  const itemize = listSkeleton("itemize");
  const enumerate = listSkeleton("enumerate");

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
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
