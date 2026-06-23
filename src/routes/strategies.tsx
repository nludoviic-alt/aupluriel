import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Power, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { SYMBOLS } from "@/lib/deriv";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { type Strategy } from "@/lib/strategies";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/strategies")({
  head: () => ({ meta: [{ title: "Stratégies — LIO23" }] }),
  component: StrategiesPage,
});

const STORAGE_KEY = "lio23.strategies";

const DEFAULTS: Strategy[] = [
  { id: "s1", name: "RSI Mean Reversion", pair: "BTC/USD", indicator: "RSI", buyThreshold: 30, sellThreshold: 70, stopLoss: 2, takeProfit: 4, enabled: true },
  { id: "s2", name: "EMA Trend Follow", pair: "EUR/USD", indicator: "EMA_CROSS", buyThreshold: 50, sellThreshold: 200, stopLoss: 1, takeProfit: 3, enabled: false },
];

function StrategiesPage() {
  const [items, setItems] = useState<Strategy[]>([]);
  const [editing, setEditing] = useState<Strategy | null>(null);
  const { confirmState, confirm } = useConfirm();

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      setItems(raw ? JSON.parse(raw) : DEFAULTS);
    } catch {
      setItems(DEFAULTS);
    }
  }, []);

  const activeCount = items.filter((s) => s.enabled).length;

  function persist(next: Strategy[]) {
    setItems(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function toggle(id: string) {
    persist(items.map((i) => (i.id === id ? { ...i, enabled: !i.enabled } : i)));
  }

  async function remove(id: string) {
    const s = items.find((i) => i.id === id);
    const ok = await confirm({
      title: "Supprimer la stratégie ?",
      description: `"${s?.name}" sera définitivement supprimée.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    persist(items.filter((i) => i.id !== id));
    toast.success("Stratégie supprimée");
  }

  function save(s: Strategy) {
    const exists = items.some((i) => i.id === s.id);
    persist(exists ? items.map((i) => (i.id === s.id ? s : i)) : [...items, s]);
    setEditing(null);
    toast.success(`Stratégie ${exists ? "mise à jour" : "créée"}`);
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Stratégies</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Crée tes propres règles — connectées en temps réel à l'Auto-Trader.
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full sm:w-auto sm:flex-row sm:items-center sm:gap-2.5">
          {activeCount > 0 && (
            <Link to="/autotrader" className="w-full sm:w-auto">
              <span className="flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--bull)]/30 bg-[color:var(--bull)]/10 px-3 py-2.5 text-xs font-semibold text-[color:var(--bull)] sm:py-1.5 sm:px-2.5">
                <Zap className="h-4 w-4" />
                {activeCount} stratégie{activeCount > 1 ? "s" : ""} active{activeCount > 1 ? "s" : ""} · Auto-Trader
              </span>
            </Link>
          )}
          <Button
            onClick={() =>
              setEditing({
                id: `s${Date.now()}`,
                name: "Nouvelle stratégie",
                pair: "BTC/USD",
                indicator: "RSI",
                buyThreshold: 30,
                sellThreshold: 70,
                stopLoss: 2,
                takeProfit: 4,
                enabled: true,
              })
            }
            className="w-full sm:w-auto bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] font-bold h-11 text-sm sm:h-9"
          >
            <Plus className="mr-2 h-4.5 w-4.5" /> Nouvelle
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((s) => (
          <div key={s.id} className="glass-panel rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">{s.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {s.pair} · {s.indicator} · SL {s.stopLoss}% / TP {s.takeProfit}%
                </p>
              </div>
              <Switch checked={s.enabled} onCheckedChange={() => toggle(s.id)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-muted/40 px-2 py-0.5">
                BUY {s.indicator === "EMA_CROSS" ? `EMA${s.buyThreshold}` : `≤ ${s.buyThreshold}`}
              </span>
              <span className="rounded-md bg-muted/40 px-2 py-0.5">
                SELL {s.indicator === "EMA_CROSS" ? `EMA${s.sellThreshold}` : `≥ ${s.sellThreshold}`}
              </span>
              <span className="rounded-md bg-muted/40 px-2 py-0.5">SL {s.stopLoss}% / TP {s.takeProfit}%</span>
              <span className={cn("rounded-md px-2 py-0.5", s.enabled ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]" : "bg-muted/40 text-muted-foreground")}>
                <Power className="mr-1 inline h-3 w-3" />
                {s.enabled ? "Active" : "En pause"}
              </span>
              {s.enabled && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)] px-2 py-0.5">
                  <Zap className="h-3 w-3" /> Auto-Trader
                </span>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2.5">
              <Button variant="outline" size="sm" onClick={() => setEditing(s)} className="h-10 px-4 text-xs sm:h-8 sm:px-3">
                Éditer
              </Button>
              <Button variant="ghost" size="sm" onClick={() => remove(s.id)} className="text-[color:var(--bear)] hover:text-[color:var(--bear)] h-10 w-10 sm:h-8 sm:w-8 p-0 flex items-center justify-center border border-border sm:border-0 sm:bg-transparent bg-muted/5 rounded-lg">
                <Trash2 className="h-4.5 w-4.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {editing && <StrategyEditor strategy={editing} onCancel={() => setEditing(null)} onSave={save} />}
      <ConfirmDialog state={confirmState} />
    </div>
  );
}

function StrategyEditor({
  strategy,
  onSave,
  onCancel,
}: {
  strategy: Strategy;
  onSave: (s: Strategy) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(strategy);
  function patch<K extends keyof Strategy>(k: K, v: Strategy[K]) {
    setS({ ...s, [k]: v });
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4">
      <div className="glass-panel w-full max-w-lg rounded-xl p-5 shadow-2xl">
        <h3 className="text-lg font-bold">{strategy.name === "Nouvelle stratégie" ? "Créer une stratégie" : "Éditer la stratégie"}</h3>
        <div className="mt-4 grid gap-3.5 grid-cols-1 sm:grid-cols-2">
          <Field label="Nom">
            <input className="input" value={s.name} onChange={(e) => patch("name", e.target.value)} />
          </Field>
          <Field label="Paire">
            <select className="input" value={s.pair} onChange={(e) => patch("pair", e.target.value)}>
              {SYMBOLS.map((x) => (
                <option key={x.deriv}>{x.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Indicateur">
            <select className="input" value={s.indicator} onChange={(e) => patch("indicator", e.target.value as Strategy["indicator"])}>
              <option value="RSI">RSI</option>
              <option value="MACD">MACD</option>
              <option value="EMA_CROSS">EMA Cross</option>
              <option value="BB">Bollinger</option>
            </select>
          </Field>
          <div className="hidden sm:block" />
          <Field label="BUY (seuil)">
            <input type="number" className="input" value={s.buyThreshold} onChange={(e) => patch("buyThreshold", Number(e.target.value))} />
          </Field>
          <Field label="SELL (seuil)">
            <input type="number" className="input" value={s.sellThreshold} onChange={(e) => patch("sellThreshold", Number(e.target.value))} />
          </Field>
          <Field label="Stop Loss (%)">
            <input type="number" className="input" value={s.stopLoss} onChange={(e) => patch("stopLoss", Number(e.target.value))} />
          </Field>
          <Field label="Take Profit (%)">
            <input type="number" className="input" value={s.takeProfit} onChange={(e) => patch("takeProfit", Number(e.target.value))} />
          </Field>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:justify-end sm:gap-2">
          <Button variant="outline" onClick={onCancel} className="h-11 text-sm sm:h-9">
            Annuler
          </Button>
          <Button
            onClick={() => onSave(s)}
            className="bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] font-bold h-11 text-sm sm:h-9"
          >
            Enregistrer
          </Button>
        </div>
      </div>
      <style>{`.input { width:100%; border-radius:8px; border:1px solid var(--border); background: var(--background); padding: 12px 14px; font-size: 14px; color: var(--foreground); } @media (min-width: 640px) { .input { padding: 8px 12px; } }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}