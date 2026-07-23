import { useState, useRef, useEffect } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface HelpBubbleProps {
  text: string;
  className?: string;
}

export function HelpBubble({ text, className }: HelpBubbleProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 w-64 rounded-xl border border-white/10 bg-neutral-900 px-3.5 py-2.5 text-xs text-neutral-300 shadow-xl leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}
