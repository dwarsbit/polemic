import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { DiffRows } from "@/components/DiffRows";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { collapseContext, lineDiff } from "@/lib/diff";
import { requestAiFix, type AiFix } from "@/lib/ai-fix";
import { applyFixEdits } from "@/lib/fix-issue";
import { useDialogsStore } from "@/store/dialogs";
import { useEditorStore } from "@/store/editor";
import { useSettingsStore } from "@/store/settings";

type AiFixDialogState =
  | { kind: "loading" }
  | { kind: "fix"; fix: AiFix; doc: string }
  | { kind: "error"; error: string };

/**
 * The AI fallback of "Fix this": the issue is sent to the configured
 * provider; the proposed change shows as a diff the user accepts or
 * rejects. Nothing lands in the document before Apply. Mounted only
 * while an issue is set (see App).
 */
export function AiFixDialog() {
  const issue = useDialogsStore((s) => s.aiFixIssue);
  const close = () => useDialogsStore.getState().setAiFixIssue(null);
  const ai = useSettingsStore((s) => s.ai);
  const configured = Boolean(ai?.baseUrl && ai.apiKey && ai.model);
  const [state, setState] = useState<AiFixDialogState>({ kind: "loading" });

  useEffect(() => {
    if (issue === null || !configured) return;
    let cancelled = false;
    const doc = useEditorStore.getState().content;
    requestAiFix(issue, doc, ai!).then((result) => {
      if (cancelled) return;
      if ("fix" in result) {
        if (result.fix.edits.length === 0) {
          setState({ kind: "error", error: result.fix.explanation });
        } else {
          setState({ kind: "fix", fix: result.fix, doc });
        }
      } else {
        setState({ kind: "error", error: result.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [issue, configured, ai]);

  if (issue === null) return null;

  const rows =
    state.kind === "fix"
      ? collapseContext(lineDiff(state.doc, state.fix.fixed))
      : [];

  function onApply() {
    if (state.kind !== "fix") return;
    applyFixEdits(state.fix.edits);
    if (issue !== null && issue.line !== null) {
      useEditorStore.getState().jumpTo(issue.line);
    }
    close();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex h-[70vh] max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" />
            Fix with AI
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {issue.message}
            {issue.file !== null && (
              <span>
                {" "}
                — {issue.file}
                {issue.line !== null ? `:${issue.line}` : ""}
              </span>
            )}
          </p>
        </DialogHeader>
        <div className="flex-1 min-h-0 px-6 pb-4">
          <ScrollArea className="h-full rounded border p-2">
            {!configured && (
              <p className="p-2 text-xs text-amber-600">
                No AI provider is configured — set one up in Settings → AI.
              </p>
            )}
            {configured && state.kind === "loading" && (
              <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Asking the model for a fix…
              </p>
            )}
            {configured && state.kind === "error" && (
              <p className="p-2 text-xs text-amber-600">{state.error}</p>
            )}
            {configured && state.kind === "fix" && (
              <>
                <p className="p-2 text-xs">{state.fix.explanation}</p>
                <DiffRows rows={rows} />
              </>
            )}
          </ScrollArea>
        </div>
        <DialogFooter className="border-t px-6 py-3 sm:justify-between">
          <p className="hidden text-xs text-muted-foreground sm:block">
            Nothing is written to the file until you apply.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={close}>
              {state.kind === "fix" ? "Discard" : "Close"}
            </Button>
            {state.kind === "fix" && <Button onClick={onApply}>Apply fix</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
