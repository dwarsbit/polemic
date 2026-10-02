import * as React from "react";
import { cn } from "cn";

/**
 * Joined buttons: only the outer corners are rounded, and adjacent
 * borders overlap by a pixel so the group reads as one control.
 */
function ButtonGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        "flex w-fit items-center",
        "[&>[data-slot=button]]:relative [&>[data-slot=button]]:rounded-none [&>[data-slot=button]]:-ml-px",
        "[&>[data-slot=button]:first-child]:ml-0 [&>[data-slot=button]:first-child]:rounded-l-md",
        "[&>[data-slot=button]:last-child]:rounded-r-md",
        "[&>[data-slot=button]:focus-visible]:z-10",
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup };
