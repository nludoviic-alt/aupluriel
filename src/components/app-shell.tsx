import { type ReactNode } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full flex-col">{children}</div>;
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-border/60 px-3 py-4 md:px-6">
      <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-5 py-3.5 border-b border-border">
      <div className="text-sm font-bold uppercase tracking-wide text-foreground">{title}</div>
      {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
    </div>
  );
}

export function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold uppercase tracking-tight rounded-sm border transition-all",
        active
          ? "bg-primary/10 text-primary border-primary/30"
          : "text-muted-foreground border-transparent hover:text-foreground hover:bg-panel-light/20",
      )}
    >
      {children}
    </button>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  positive,
  negative,
  icon,
  accent,
  primary,
}: {
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
  negative?: boolean;
  icon: ReactNode;
  accent?: boolean;
  primary?: boolean;
}) {
  return (
    <div className="bg-panel/40 border border-border rounded-sm p-5 hover:border-primary/30 transition-all group flex flex-col gap-3 relative overflow-hidden">
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-[2px] transition-all group-hover:opacity-100",
          accent ? "bg-up/60" : primary ? "bg-primary/50" : "bg-border",
        )}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium group-hover:text-primary/80 transition-colors">
          {label}
        </span>
        <span
          className={cn(
            "p-1.5 rounded-sm transition-colors",
            accent
              ? "bg-up/10 text-up"
              : primary
                ? "bg-primary/10 text-primary"
                : "bg-panel-light/60 text-muted-foreground group-hover:text-primary",
          )}
        >
          {icon}
        </span>
      </div>
      <div
        className={cn(
          "font-mono-tabular text-2xl font-bold leading-none",
          primary ? "text-primary" : accent ? "text-up" : negative ? "text-down" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div
        className={cn(
          "text-xs flex items-center gap-1 font-medium",
          positive ? "text-up" : negative ? "text-down" : "text-muted-foreground",
        )}
      >
        {positive && <ArrowUpRight className="size-3.5 shrink-0" />}
        {negative && <ArrowDownRight className="size-3.5 shrink-0" />}
        {sub}
      </div>
    </div>
  );
}
