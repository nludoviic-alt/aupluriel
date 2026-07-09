import { cn } from "@/lib/utils";


export function LogoFull({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="leading-tight">
        <div className="text-base font-extrabold tracking-tight brand-gradient-text">Lio23</div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">Quant Trading</div>
      </div>
    </div>
  );
}
