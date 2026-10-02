import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import {
  Toggle as TogglePrimitive,
  ToggleGroup as ToggleGroupPrimitive,
} from "radix-ui";

/**
 * Set by ToggleButtonGroup: inside a group the button renders as a
 * ToggleGroup item (selection managed by the group); standalone it is a
 * self-contained press toggle.
 */
const ToggleButtonGroupContext = React.createContext(false);

const toggleButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        outline:
          "border-border bg-background shadow-xs hover:bg-muted hover:text-foreground data-[state=on]:border-primary/20 data-[state=on]:bg-primary/10 data-[state=on]:text-foreground dark:bg-transparent dark:data-[state=on]:bg-primary/15",
        ghost:
          "hover:bg-muted hover:text-foreground data-[state=on]:bg-muted data-[state=on]:text-foreground dark:hover:bg-muted/50",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-3",
        xs: "h-6 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

function omit<T extends Record<string, unknown>>(obj: T, keys: string[]): unknown {
  const copy: Record<string, unknown> = { ...obj };
  for (const key of keys) delete copy[key];
  return copy;
}

function ToggleButton({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & {
  /** Required when used inside a ToggleButtonGroup. */
  value?: string;
} & VariantProps<typeof toggleButtonVariants>) {
  const inGroup = React.useContext(ToggleButtonGroupContext);

  if (inGroup) {
    return (
      <ToggleGroupPrimitive.Item
        data-slot="toggle-button"
        data-variant={variant}
        data-size={size}
        className={cn(toggleButtonVariants({ variant, size }), className)}
        {...(omit(props, [
          "pressed",
          "defaultPressed",
          "onPressedChange",
        ]) as unknown as React.ComponentProps<typeof ToggleGroupPrimitive.Item>)}
      />
    );
  }

  return (
    <TogglePrimitive.Root
      data-slot="toggle-button"
      data-variant={variant}
      data-size={size}
      className={cn(toggleButtonVariants({ variant, size }), className)}
      {...(omit(props, ["value"]) as React.ComponentProps<typeof TogglePrimitive.Root>)}
    />
  );
}

export { ToggleButton, toggleButtonVariants, ToggleButtonGroupContext };
