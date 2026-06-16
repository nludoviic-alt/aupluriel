import { useCallback, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface ConfirmDialogProps {
  state: ConfirmState | null;
}

export function ConfirmDialog({ state }: ConfirmDialogProps) {
  if (!state) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
      <div className="glass-panel w-full max-w-sm rounded-xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
            state.danger
              ? "bg-[color:var(--bear)]/10 text-[color:var(--bear)]"
              : "bg-amber-500/10 text-amber-400",
          )}>
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{state.title}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">{state.description}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={() => state.resolve(false)}>
            Annuler
          </Button>
          <Button
            size="sm"
            onClick={() => state.resolve(true)}
            className={cn(
              "font-semibold",
              state.danger
                ? "bg-[color:var(--bear)] text-white hover:bg-[color:var(--bear)]/80"
                : "bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)]",
            )}
          >
            {state.confirmLabel ?? "Confirmer"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        ...opts,
        resolve: (ok) => {
          setState(null);
          resolve(ok);
        },
      });
    });
  }, []);

  return { confirmState: state, confirm };
}
