import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface AmountInputProps {
  value: number;
  min: number;
  max: number;
  step: number;
  /** Prefix shown on +/- buttons context, e.g. "$". Optional. */
  unit?: string;
  /**
   * Called only when a change is COMMITTED (button click, blur, or Enter).
   * Return true to accept the new value, false/undefined to reject it
   * (e.g. user cancelled a confirmation dialog).
   */
  onCommit: (next: number, reason: "increment" | "decrement" | "typed") => Promise<boolean> | boolean;
  disabled?: boolean;
}

/**
 * Number input that NEVER fires confirmation on each keystroke.
 * - Free typing into a local draft (input stays responsive)
 * - Commits on blur or Enter
 * - +/- buttons commit immediately
 * The committed value is owned by the parent via `value`.
 */
export function AmountInput({ value, min, max, step, unit, onCommit, disabled }: AmountInputProps) {
  const [draft, setDraft] = useState(String(value));

  // Keep draft in sync when the committed value changes externally
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function clamp(n: number) {
    return Math.min(max, Math.max(min, n));
  }

  async function commitTyped() {
    const parsed = Number(draft);
    if (Number.isNaN(parsed)) {
      setDraft(String(value)); // revert invalid input
      return;
    }
    const next = clamp(parsed);
    if (next === value) {
      setDraft(String(value));
      return;
    }
    const ok = await onCommit(next, "typed");
    setDraft(String(ok ? next : value)); // revert if rejected
  }

  async function step1(dir: "increment" | "decrement") {
    const next = clamp(dir === "increment" ? value + step : value - step);
    if (next === value) return;
    const ok = await onCommit(next, dir);
    if (!ok) setDraft(String(value));
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => step1("decrement")}
        className="rounded-md border border-border bg-background px-2.5 py-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitTyped}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setDraft(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn("cfg-input text-center")}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => step1("increment")}
        className="rounded-md border border-border bg-background px-2.5 py-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
