import type { ReactNode } from "react";

/**
 * One settings row: label and description on the left, the control in
 * a fixed-width column on the right so controls line up down a page.
 * Rows stack inside a `divide-y` container.
 */
export function SettingsRow({
  label,
  description,
  control,
  children,
}: {
  label: string;
  description?: ReactNode;
  /** null for a row that is only a label (its content goes below). */
  control: ReactNode;
  /** Content under the row (a path, a second field, a status). */
  children?: ReactNode;
}) {
  return (
    <div className="py-3 first:pt-1 last:pb-1">
      <div className="flex min-h-8 items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {description && (
            <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
          )}
        </div>
        {control !== null && (
          <div className="flex w-44 shrink-0 justify-end">{control}</div>
        )}
      </div>
      {children}
    </div>
  );
}
