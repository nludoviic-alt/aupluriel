import { cn } from "@/lib/utils";

/**
 * Vertex logo mark — uses the newly supplied official image served from /logo.png.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <div className={cn(
      "relative flex items-center justify-center rounded-full overflow-hidden shadow-2xl shrink-0",
      "bg-black",
      className
    )}>
      <img 
        src="/logo-vertex.png" 
        alt="Vertex" 
        className="absolute inset-0 w-full h-full object-cover opacity-90"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
      <span className="relative z-10 text-[min(10px,25%)] font-black tracking-tighter text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] select-none leading-none">
        VERTEX
      </span>
    </div>
  );
}

export function LogoFull({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="leading-tight">
        <div className="text-base font-extrabold tracking-tight brand-gradient-text">Vertex</div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">Quant Trading</div>
      </div>
    </div>
  );
}
