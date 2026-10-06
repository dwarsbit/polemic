import * as React from "react";
import { cn } from "cn";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { ToggleButtonGroupContext } from "@/components/ui/toggle-button";

/**
 * Joined toggle buttons, styled like a ButtonGroup: no container well,
 * only the outer corners are rounded, and adjacent borders overlap by
 * a pixel so the group reads as one control.
 */
function ToggleButtonGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleButtonGroupContext.Provider value={true}>
      <ToggleGroupPrimitive.Root
        data-slot="toggle-button-group"
        className={cn(
          "flex w-fit items-center",
          "[&>[data-slot=toggle-button]]:relative [&>[data-slot=toggle-button]]:rounded-none [&>[data-slot=toggle-button]]:-ml-px",
          "[&>[data-slot=toggle-button]:first-child]:ml-0 [&>[data-slot=toggle-button]:first-child]:rounded-l-md",
          "[&>[data-slot=toggle-button]:last-child]:rounded-r-md",
          "[&>[data-slot=toggle-button]:focus-visible]:z-10",
          className,
        )}
        {...props}
      />
    </ToggleButtonGroupContext.Provider>
  );
}

export { ToggleButtonGroup };
