/** Line-art illustrations for the template picker. Strokes use currentColor. */
const ART_PROPS = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
};

export function TemplateArt({ id }: { id: string }) {
  if (id === "beamer") {
    return (
      <svg viewBox="0 0 36 27" className="h-9 w-12 text-muted-foreground">
        <rect x="1.5" y="1.5" width="33" height="24" rx="2" {...ART_PROPS} />
        <line x1="6" y1="7" x2="20" y2="7" {...ART_PROPS} />
        <line x1="6" y1="13" x2="30" y2="13" {...ART_PROPS} />
        <line x1="6" y1="18" x2="26" y2="18" {...ART_PROPS} />
      </svg>
    );
  }
  if (id === "thesis") {
    return (
      <svg viewBox="0 0 30 36" className="h-9 w-8 text-muted-foreground">
        <rect x="7.5" y="1.5" width="21" height="33" rx="1.5" {...ART_PROPS} />
        <line x1="12" y1="7" x2="25" y2="7" {...ART_PROPS} />
        <line x1="12" y1="12" x2="25" y2="12" {...ART_PROPS} />
        <line x1="12" y1="17" x2="22" y2="17" {...ART_PROPS} />
        <rect
          x="1.5"
          y="4.5"
          width="21"
          height="30"
          rx="1.5"
          fill="var(--card)"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <line x1="5" y1="10" x2="19" y2="10" {...ART_PROPS} />
        <line x1="5" y1="15" x2="19" y2="15" {...ART_PROPS} />
        <line x1="5" y1="20" x2="15" y2="20" {...ART_PROPS} />
        <line x1="5" y1="25" x2="19" y2="25" {...ART_PROPS} />
      </svg>
    );
  }
  if (id === "report") {
    return (
      <svg viewBox="0 0 28 36" className="h-9 w-7 text-muted-foreground">
        <rect x="1.5" y="1.5" width="25" height="33" rx="1.5" {...ART_PROPS} />
        <line x1="6" y1="6" x2="18" y2="6" {...ART_PROPS} />
        <line x1="6" y1="12" x2="16" y2="12" {...ART_PROPS} />
        <line x1="9" y1="17" x2="20" y2="17" {...ART_PROPS} />
        <line x1="9" y1="21" x2="20" y2="21" {...ART_PROPS} />
        <line x1="9" y1="25" x2="17" y2="25" {...ART_PROPS} />
        <line x1="6" y1="30" x2="20" y2="30" {...ART_PROPS} />
      </svg>
    );
  }
  if (id === "blank") {
    return (
      <svg viewBox="0 0 28 36" className="h-9 w-7 text-muted-foreground">
        <rect
          x="2"
          y="2"
          width="24"
          height="32"
          rx="1.5"
          {...ART_PROPS}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }
  // article (default)
  return (
    <svg viewBox="0 0 28 36" className="h-9 w-7 text-muted-foreground">
      <rect x="1.5" y="1.5" width="25" height="33" rx="1.5" {...ART_PROPS} />
      <line x1="6" y1="7" x2="22" y2="7" {...ART_PROPS} />
      <line x1="6" y1="13" x2="20" y2="13" {...ART_PROPS} />
      <line x1="6" y1="17" x2="20" y2="17" {...ART_PROPS} />
      <line x1="6" y1="21" x2="22" y2="21" {...ART_PROPS} />
      <line x1="6" y1="25" x2="18" y2="25" {...ART_PROPS} />
      <line x1="6" y1="29" x2="22" y2="29" {...ART_PROPS} />
    </svg>
  );
}
