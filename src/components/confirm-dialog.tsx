import { useCallback, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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
  return (
    <Dialog open={!!state} onOpenChange={(open) => { if (!open && state) state.resolve(false); }}>
      <DialogContent
        className="glass-panel border-white/10 bg-[#0A0A0A]/95 backdrop-blur-2xl sm:rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] max-w-sm">
        {state && (
          <>
            <DialogHeader>
              <DialogTitle className="text-sm font-bold uppercase tracking-widest text-foreground flex items-center gap-2.5">
                <div className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                  state.danger
                    ? "bg-[color:var(--bear)]/10 text-[color:var(--bear)]"
                    : "bg-amber-500/10 text-amber-400",
                )}>
                  <AlertTriangle className="h-4 w-4" />
                </div>
                {state.title}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {state.description}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => state.resolve(false)}
                className="flex-1 border-white/5 hover:bg-white/[0.04] text-xs h-9"
              >
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={() => state.resolve(true)}
                className={cn(
                  "flex-1 font-bold text-xs h-9",
                  state.danger
                    ? "bg-[color:var(--bear)] text-white hover:bg-[color:var(--bear)]/80"
                    : "bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white",
                )}
              >
                {state.confirmLabel ?? "Confirmer"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
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
