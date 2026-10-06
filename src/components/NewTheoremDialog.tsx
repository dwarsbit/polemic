import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/**
 * The shared "New theorem environment" dialog: both faces declare
 * `\newtheorem{env}{Name}` through `onCommit`. Letter and duplicate
 * validation live here; `onCommit` returns an error message for
 * face-specific failures (null on success), and `existingEnvs` lists
 * the env names already declared or standard.
 */
export function NewTheoremDialog({
  open,
  onOpenChange,
  existingEnvs,
  onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingEnvs: string[];
  /** Returns an error message, or null on success. */
  onCommit: (env: string, display: string, insertInstance: boolean) => string | null;
}) {
  const [env, setEnv] = useState("");
  const [display, setDisplay] = useState("");
  const [insertInstance, setInsertInstance] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setEnv("");
    setDisplay("");
    setError(null);
    onOpenChange(false);
  };

  function commit() {
    const name = env.trim();
    if (!/^[a-zA-Z]+$/.test(name)) {
      setError("The environment name may only use letters.");
      return;
    }
    if (existingEnvs.includes(name)) {
      setError(`"${name}" is already declared.`);
      return;
    }
    const failure = onCommit(name, display, insertInstance);
    if (failure !== null) {
      setError(failure);
      return;
    }
    close();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New theorem environment</DialogTitle>
          <DialogDescription>
            Declares \newtheorem in the preamble; amsthm loads when missing.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <label htmlFor="theorem-env" className="text-xs text-muted-foreground">
              Environment name
            </label>
            <Input
              id="theorem-env"
              autoFocus
              value={env}
              placeholder="exercise"
              onChange={(e) => {
                setEnv(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="theorem-name" className="text-xs text-muted-foreground">
              Display name
            </label>
            <Input
              id="theorem-name"
              value={display}
              placeholder="Exercise (default: capitalized name)"
              onChange={(e) => {
                setDisplay(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="theorem-instance"
              checked={insertInstance}
              onCheckedChange={setInsertInstance}
            />
            <label htmlFor="theorem-instance" className="text-xs text-muted-foreground">
              Insert an instance right away
            </label>
          </div>
          {error !== null && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" onClick={commit}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
