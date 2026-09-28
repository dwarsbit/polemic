import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, RefreshCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectTex } from "@/lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";

function StatusRow({
  label,
  found,
  hint,
}: {
  label: string;
  found: boolean | null;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1">
      {found === null ? (
        <span className="mt-0.5 size-4 shrink-0" />
      ) : found ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      )}
      <div>
        <span className="text-sm font-medium">{label}</span>
        {!found && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function LinkButton({ url, label }: { url: string; label: string }) {
  return (
    <Button
      variant="link"
      className="h-auto p-0 text-xs"
      onClick={() => void openUrl(url)}
    >
      {label}
      <ExternalLink className="size-3" />
    </Button>
  );
}

export function TexStatusSection() {
  const queryClient = useQueryClient();
  const { data: tex } = useQuery({
    queryKey: ["tex-status"],
    queryFn: detectTex,
    staleTime: Infinity,
  });

  return (
    <div>
      <p className="mb-1.5 font-medium">TeX distribution</p>
      <p className="mb-1.5 text-xs text-muted-foreground">
        Polemic compiles on your machine using your own TeX installation. It needs{" "}
        <span className="font-mono">pdflatex</span> and{" "}
        <span className="font-mono">latexmk</span> on your PATH;{" "}
        <span className="font-mono">synctex</span> enables click navigation.
      </p>
      <div className="my-2">
        {tex === undefined ? (
          <p className="text-sm text-muted-foreground">Detecting…</p>
        ) : tex === null ? (
          <p className="text-sm text-muted-foreground">
            Detection is unavailable (not running in the desktop app).
          </p>
        ) : (
          <>
            <StatusRow
              label="pdflatex"
              found={tex.pdflatex.found}
              hint={tex.pdflatex.version ?? undefined}
            />
            <StatusRow
              label="latexmk"
              found={tex.latexmk.found}
              hint={tex.latexmk.version ?? undefined}
            />
          </>
        )}
      </div>
      <div className="space-y-2 rounded border p-3 text-sm">
        <p className="font-medium">Install a distribution</p>
        <p>
          macOS: MacTeX includes pdflatex, latexmk, and synctex.{" "}
          <LinkButton url="https://www.tug.org/mactex/" label="tug.org/mactex" />
        </p>
        <p>
          Linux: TeX Live from your package manager (e.g.{" "}
          <span className="font-mono">sudo apt install texlive-full</span>).{" "}
          <LinkButton url="https://tug.org/texlive/" label="tug.org/texlive" />
        </p>
        <p>
          Windows: MiKTeX installs packages on demand; latexmk comes with it.{" "}
          <LinkButton url="https://miktex.org/" label="miktex.org" />
        </p>
        <p className="text-xs text-muted-foreground">
          After installing, reopen the terminal so the new PATH is picked up, then
          re-check.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => void queryClient.invalidateQueries({ queryKey: ["tex-status"] })}
      >
        <RefreshCcw />
        Re-check
      </Button>
    </div>
  );
}
