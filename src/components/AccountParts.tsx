import { UserRound } from "lucide-react";
import { formatStorage } from "@/components/UsageSummary";
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

const minutes = (seconds: number) => Number((seconds / 60).toFixed(1));

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
}: {
  label: string;
  value: string;
  share: number | null;
  full: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("tabular-nums", full && "text-warning")}>{value}</span>
      </div>
      {share !== null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              full ? "bg-warning" : "bg-primary-fill dark:bg-primary",
            )}
            style={{ width: `${Math.min(100, Math.max(2, share * 100))}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Storage and today's compile time against the plan, from GET /api/usage. */
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
      {compile.limitSeconds === null ? (
        <Meter
          label="Compile time today"
          value={`${minutes(compile.usedSeconds)} minutes`}
          share={null}
          full={false}
        />
      ) : (
        <Meter
          label="Compile time today"
          value={`${minutes(compile.usedSeconds)} of ${minutes(compile.limitSeconds)} minutes`}
          share={compile.usedSeconds / compile.limitSeconds}
          full={compile.usedSeconds >= compile.limitSeconds}
        />
      )}
    </div>
  );
}
