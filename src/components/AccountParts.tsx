import { UserRound } from "lucide-react";
import { formatCompileUsed, formatStorage } from "@/components/UsageSummary";
import type { AccountUsage, AccountUser } from "@/lib/tauri";
import { initialsOf } from "@/store/settings";
import { cn } from "cn";

/** Plan names as the account page shows them; "professional" comes from servers before the current plans. */
export const PLAN_NAMES: Record<NonNullable<AccountUser["plan"]>, string> = {
  free: "Free",
  student: "Student",
  pro: "Pro",
  professional: "Pro",
};

const SIZES = {
  sm: "size-7 text-[11px]",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
} as const;

/** The sign-in photo, else the initials on a primary circle, else a person icon. */
export function Avatar({
  name,
  photo,
  size = "md",
  className,
}: {
  name?: string;
  photo?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", SIZES[size], className)}
      />
    );
  }
  // First and last, as two letters fit every size: "Anna de Vries" is AV.
  const all = name ? initialsOf(name) : "";
  const initials = all.length > 2 ? all[0] + all.slice(-1) : all;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        initials
          ? "bg-primary-fill text-white dark:bg-primary"
          : "bg-muted text-muted-foreground",
        SIZES[size],
        className,
      )}
      aria-hidden
    >
      {initials || <UserRound className={size === "sm" ? "size-4" : "size-5"} />}
    </div>
  );
}

function Meter({
  label,
  value,
  share,
  full,
  note,
}: {
  label: string;
  value: string;
  share: number;
  full: boolean;
  /** Shown under the bar once it is full. */
  note?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("tabular-nums", full && "text-warning")}>{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            full ? "bg-warning" : "bg-primary-fill dark:bg-primary",
          )}
          style={{ width: `${Math.min(100, Math.max(2, share * 100))}%` }}
        />
      </div>
      {full && note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** Storage against the plan and the share of today's cloud compile used, from GET /api/usage. */
export function UsageMeters({
  usage,
  className,
}: {
  usage: Pick<AccountUsage, "storage" | "compile">;
  className?: string;
}) {
  const { storage, compile } = usage;
  return (
    <div className={className}>
      <Meter
        label="Storage"
        value={`${formatStorage(storage.usedBytes)} of ${formatStorage(storage.limitBytes)}`}
        share={storage.usedBytes / storage.limitBytes}
        full={storage.usedBytes >= storage.limitBytes}
      />
      <Meter
        label="Cloud compile today"
        value={formatCompileUsed(compile.usedPercent)}
        share={compile.usedPercent / 100}
        full={compile.usedPercent >= 100}
        note="More from midnight UTC"
      />
    </div>
  );
}
