import { Loader2 } from "lucide-react";

/** Splash shown until the app knows whether to show library or editor. */
export function LoadingScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <p className="text-lg font-semibold tracking-tight">Polemic</p>
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}
