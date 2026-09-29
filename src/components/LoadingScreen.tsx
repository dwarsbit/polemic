import logo from "../../assets/polemic-logo.svg";

/** Splash shown until the app knows whether to show library or editor. */
export function LoadingScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <img src={logo} alt="Polemic" className="size-20" draggable={false} />
      <p className="text-lg font-semibold tracking-tight">Polemic</p>
      <div className="relative h-1 w-40 overflow-hidden rounded-full bg-muted">
        <div className="loading-bar-fill h-full w-1/3 rounded-full bg-primary" />
      </div>
    </div>
  );
}
