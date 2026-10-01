import { Button } from "@/components/ui/button";

/**
 * The Visual face for a .tex file — the placeholder for the rich
 * text editor (WYSIWYG, tiptap-based) that will live here: edit the
 * rendered document directly, with the TeX written behind the scenes.
 */
export function VisualModeStub({ onGoToCode }: { onGoToCode: () => void }) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-sm rounded-xl border bg-background px-6 py-5 text-center shadow-sm">
        <p className="text-sm font-medium">Visual mode is coming soon</p>
        <p className="mt-1 text-xs text-muted-foreground">
          A rich text editor will live here: write the rendered
          document directly, with the TeX written for you behind the
          scenes.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={onGoToCode}
        >
          Back to Code
        </Button>
      </div>
    </div>
  );
}
