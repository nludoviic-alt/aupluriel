import { cn } from "@/lib/utils";

/**
 * Vertex logo mark — uses the newly supplied official image served from /logo.png.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="Vertex Logo"
      className={cn("h-16 w-24 object-contain rounded-lg shadow-md", className)}
    />
  );
}

export function LogoFull({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="leading-tight">
        <div className="text-base font-extrabold tracking-tight brand-gradient-text">Vertex</div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">Quant Trading AI</div>
      </div>
    </div>
  );
}
