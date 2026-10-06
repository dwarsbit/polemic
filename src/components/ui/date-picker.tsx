import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * A single-date picker (the shadcn pattern): an outline button that
 * opens the calendar in a popover. Picking a day (or clearing with
 * the button again) closes the popover.
 */
function DatePicker({
  value,
  onValueChange,
  placeholder = "Pick a date",
  className,
  disabled,
}: {
  value: Date | undefined;
  onValueChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-fit justify-between gap-2 font-normal",
            value === undefined && "text-muted-foreground",
            className,
          )}
        >
          {value === undefined
            ? placeholder
            : value.toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
          <CalendarIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value}
          defaultMonth={value}
          onSelect={(date) => {
            onValueChange(date);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
