import { useMemo } from "react";
import { usePresenceStore, type Peer } from "@/store/presence";
import { useProjectStore } from "@/store/project";
import { initialsOf } from "@/store/settings";

/** How many people show before "+N". */
const SHOWN = 4;

/**
 * Who else has the project open (online): one circle per person, in
 * their cursor color. Clicking one opens the file they're in.
 */
export function PresenceAvatars() {
  const peers = usePresenceStore((s) => s.peers);
  const openFile = useProjectStore((s) => s.openFile);
  const activeFile = useProjectStore((s) => s.activeFile);

  // One circle per person, from the tab they last moved in.
  const people = useMemo(() => {
    const byUser = new Map<string, Peer>();
    for (const peer of peers) {
      const known = byUser.get(peer.userId);
      if (!known || (peer.file !== null && known.file === null))
        byUser.set(peer.userId, peer);
    }
    return [...byUser.values()];
  }, [peers]);

  if (people.length === 0) return null;
  const shown = people.slice(0, SHOWN);
  const more = people.length - shown.length;

  return (
    <div className="flex items-center -space-x-1.5" aria-label="Also in this project">
      {shown.map((person) => {
        const where = person.file ? `, in ${person.file}` : "";
        const canOpen = person.file !== null && person.file !== activeFile;
        return (
          <button
            key={person.userId}
            type="button"
            className="flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-background disabled:cursor-default"
            style={{ backgroundColor: person.color }}
            title={`${person.name}${where}`}
            aria-label={`${person.name}${where}`}
            disabled={!canOpen}
            onClick={() => {
              if (person.file) void openFile(person.file);
            }}
          >
            {initialsOf(person.name).slice(0, 2) || "?"}
          </button>
        );
      })}
      {more > 0 && (
        <span
          className="flex size-7 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground ring-2 ring-background"
          title={people
            .slice(SHOWN)
            .map((person) => person.name)
            .join(", ")}
        >
          +{more}
        </span>
      )}
    </div>
  );
}
