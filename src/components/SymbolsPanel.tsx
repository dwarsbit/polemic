import { useState } from "react";
import { MATH_SYMBOL_CATEGORIES } from "@/lib/math-symbols";
import { insertAtCursor } from "@/lib/editor-insert";
import { SectionHeader } from "@/components/SectionHeader";

export function SymbolsPanel({
  collapsed = false,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const [categoryId, setCategoryId] = useState(MATH_SYMBOL_CATEGORIES[0].id);
  const category =
    MATH_SYMBOL_CATEGORIES.find((c) => c.id === categoryId) ??
    MATH_SYMBOL_CATEGORIES[0];

  return (
    <div className="flex h-full flex-col">
      <SectionHeader label="SYMBOLS" collapsed={collapsed} onToggle={onToggle} />
      {collapsed === false && (
        <>
          <div className="px-3 pb-1">
            <select
              className="h-7 w-full rounded-md border bg-background px-1.5 text-xs"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {MATH_SYMBOL_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            <div className="grid grid-cols-6 gap-1">
              {category.symbols.map((symbol) => (
                <button
                  key={symbol.insert}
                  type="button"
                  title={symbol.label ?? symbol.insert}
                  className="flex h-8 items-center justify-center rounded border border-transparent text-base hover:border-border hover:bg-accent"
                  onClick={() => insertAtCursor(symbol.insert, symbol.cursorOffset)}
                >
                  {symbol.glyph}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
