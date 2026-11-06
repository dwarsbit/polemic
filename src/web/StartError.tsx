import { Button } from "@/components/ui/button";

/** Instead of the app, when the browser build can't tell who is signed in. */
export function StartError({ message }: { message: string }) {
  return (
    <div className="flex h-screen items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-sm">{message}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
