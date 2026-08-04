import { SYMBOLS } from "@/lib/deriv";
import { cn } from "@/lib/utils";

/** Toggle grid for picking the "Prise Rapide" favorite symbols — shared between
 * the manual tab's inline popover and Config › Paramètres, so there's one
 * editor for one piece of state (quickSymbols) instead of two to keep in sync. */
export function QuickMarketsEditor({
  quickSymbols,
  onSave,
  min = 1,
  max = 6,
}: {
  quickSymbols: string[];
  onSave: (list: string[]) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {SYMBOLS.map((s) => {
        const isChecked = quickSymbols.includes(s.deriv);
        return (
          <button
            key={s.deriv}
            type="button"
            onClick={() => {
              let updated: string[];
              if (isChecked) {
                if (quickSymbols.length <= min) return;
                updated = quickSymbols.filter((x) => x !== s.deriv);
              } else {
                if (quickSymbols.length >= max) return;
                updated = [...quickSymbols, s.deriv];
              }
              onSave(updated);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all",
              isChecked
                ? "border-primary/50 bg-primary/20 text-primary shadow-sm"
                : "border-border/60 bg-card/30 text-muted-foreground hover:bg-card/60 hover:text-foreground"
            )}
          >
            <span className="font-extrabold">{isChecked ? "✓" : "+"}</span>
            <span>{s.label}</span>
            <span className="text-[10px] font-normal opacity-60">({s.market})</span>
          </button>
        );
      })}
    </div>
  );
}
