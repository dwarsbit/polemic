import * as React from "react";
import { cn } from "cn";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { ToggleButtonGroupContext } from "@/components/ui/toggle-button";

function ToggleButtonGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleButtonGroupContext.Provider value={true}>
      <ToggleGroupPrimitive.Root
        data-slot="toggle-button-group"
        className={cn(
          "flex w-fit items-center gap-0.5 rounded-4xl border border-border bg-muted/40 p-0.5",
          className,
        )}
        {...props}
      />
    </ToggleButtonGroupContext.Provider>
  );
}

export { ToggleButtonGroup };
