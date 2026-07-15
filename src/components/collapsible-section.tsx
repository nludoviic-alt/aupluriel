import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One panel header + collapse toggle, mobile-only — dense pages (Paramètres,
 * Administration) stack their sections to 1 column below `md`, and all of
 * them open at once is a lot of scroll for "just the necessary". `md:block`
 * always wins past that breakpoint, so desktop keeps every section open
 * regardless of `open`.
 */
export function CollapsibleSection({
  icon, title, description, defaultOpen = false, accentClassName, children,
}: {
  icon: ReactNode; title: string; description?: string; defaultOpen?: boolean;
  accentClassName?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("glass-panel rounded-2xl p-6 shadow-sm space-y-5 border border-border/40", accentClassName)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left md:cursor-default"
      >
        <div className="flex items-start gap-3">
          {icon}
          <div>
            <h2 className="text-sm md:text-base font-bold uppercase tracking-wider text-neutral-200">{title}</h2>
            {description && <p className="text-xs md:text-sm text-muted-foreground mt-1">{description}</p>}
          </div>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 mt-1 text-muted-foreground transition-transform md:hidden", open && "rotate-180")} />
      </button>
      <div className={cn(open ? "block" : "hidden", "md:block space-y-5")}>{children}</div>
    </div>
  );
}

/**
 * Same collapse behavior as CollapsibleSection, but for sections whose header
 * has its own interactive content (search inputs, buttons) that can't sit
 * inside a <button> trigger — the chevron toggle is a sibling instead of a
 * wrapper, and the caller keeps full control of the outer wrapper's classes.
 */
export function CollapsibleBlock({
  header, defaultOpen = false, className, children, alwaysCollapsible = false,
}: {
  header: ReactNode; defaultOpen?: boolean; className?: string; children: ReactNode;
  /** Collapses on desktop too, not just mobile — a real dropdown instead of the usual "always open past md" sections. */
  alwaysCollapsible?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{header}</div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Réduire" : "Développer"}
          className={cn("shrink-0 mt-1 text-muted-foreground hover:text-foreground transition-colors", !alwaysCollapsible && "md:hidden")}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      <div className={cn(open ? "block" : "hidden", !alwaysCollapsible && "md:block")}>{children}</div>
    </div>
  );
}
