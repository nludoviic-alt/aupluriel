import { cn } from "@/lib/utils";

/**
 * Lio23 logo mark — uses the official image served from /logo-lio23.png.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <div className={cn(
      "relative flex items-center justify-center rounded-full overflow-hidden shadow-2xl shrink-0",
      "bg-black",
      className
    )}>
      <img
        src="/logo-lio23.png"
        alt="Lio23"
        className="absolute inset-0 w-full h-full object-cover"
      />
    </div>
  );
}

export function LogoFull({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="leading-tight">
        <div className="text-base font-extrabold tracking-tight brand-gradient-text">Lio23</div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">Quant Trading</div>
      </div>
    </div>
  );
}
