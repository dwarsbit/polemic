import { PolemicLogoVertical } from "@/components/PolemicLogo";

/** Splash shown until the app knows whether a project reopens. */
export function LoadingScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <PolemicLogoVertical className="h-28 w-auto" />
      <div className="relative h-1 w-40 overflow-hidden rounded-full bg-muted">
        <div className="loading-bar-fill h-full w-1/3 rounded-full bg-primary" />
      </div>
    </div>
  );
}
