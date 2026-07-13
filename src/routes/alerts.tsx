import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, BellRing, CheckCircle2, Plus, Trash2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { SYMBOLS, subscribeTicks } from "@/lib/deriv";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/alerts")({
  head: () => ({ meta: [{ title: "Alertes — PLURIEL" }] }),
  component: AlertsPage,
});

interface Alert {
  id: string;
  type: "price" | "signal" | "drawdown";
  pair: string;
  condition: string;
  value: number;
  enabled: boolean;
}

const KEY = "lio23.alerts";
const FIRED_KEY = "lio23.alerts_fired";
const DEFAULTS: Alert[] = [
  { id: "a1", type: "price", pair: "BTC/USD", condition: ">", value: 70000, enabled: true },
  { id: "a2", type: "signal", pair: "EUR/USD", condition: "BUY", value: 0, enabled: true },
  { id: "a3", type: "drawdown", pair: "Portfolio", condition: ">", value: 5, enabled: false },
];

function AlertsPage() {
  const [items, setItems] = useState<Alert[]>([]);
  const [type, setType] = useState<Alert["type"]>("price");
  const { confirmState, confirm } = useConfirm();
  const [pair, setPair] = useState("BTC/USD");
  const [condition, setCondition] = useState(">");
  const [value, setValue] = useState(0);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [firedIds, setFiredIds] = useState<Set<string>>(new Set());
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(KEY);
      setItems(raw ? JSON.parse(raw) : DEFAULTS);
    } catch {
      setItems(DEFAULTS);
    }
    try {
      const fired: Record<string, number> = JSON.parse(localStorage.getItem(FIRED_KEY) ?? "{}");
      setFiredIds(new Set(Object.keys(fired)));
    } catch {}
    if ("Notification" in window) setNotifPerm(Notification.permission);
  }, []);

  // Subscribe to live ticks for all enabled price alerts
  useEffect(() => {
    if (!items.length) return;
    const pairs = [...new Set(
      items.filter((a) => a.enabled && a.type === "price")
        .map((a) => SYMBOLS.find((s) => s.label === a.pair)?.deriv)
        .filter(Boolean) as string[]
    )];
    const unsubs = pairs.map((deriv) =>
      subscribeTicks(deriv, (tick) => {
        setLivePrices((prev) => ({ ...prev, [deriv]: tick.quote }));
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [items]);

  function persist(next: Alert[]) {
    setItems(next);
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  }

  function add() {
    const a: Alert = { id: `a${Date.now()}`, type, pair, condition, value, enabled: true };
    persist([a, ...items]);
    toast.success("Alerte créée — surveillance active");
  }

  async function removeAlert(id: string) {
    const a = items.find((i) => i.id === id);
    const ok = await confirm({
      title: "Supprimer l'alerte ?",
      description: `Alerte "${a?.type}" sur ${a?.pair} sera définitivement supprimée.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    persist(items.filter((i) => i.id !== id));
  }

  function toggleAlert(id: string) {
    persist(items.map((i) => (i.id === id ? { ...i, enabled: !i.enabled } : i)));
  }

  async function requestNotif() {
    if (!("Notification" in window)) return;
    const r = await Notification.requestPermission();
    setNotifPerm(r);
    if (r === "granted") toast.success("Notifications activées !");
    else toast.error("Notifications refusées par le navigateur");
  }

  function liveStatus(a: Alert): { price: number | null; triggered: boolean } {
    if (a.type !== "price") return { price: null, triggered: false };
    const deriv = SYMBOLS.find((s) => s.label === a.pair)?.deriv;
    const price = deriv ? (livePrices[deriv] ?? null) : null;
    if (price === null) return { price: null, triggered: false };
    const triggered =
      (a.condition === ">" && price > a.value) ||
      (a.condition === "<" && price < a.value);
    return { price, triggered };
  }

  const TYPE_LABEL: Record<Alert["type"], string> = {
    price: "Prix",
    signal: "Signal IA",
    drawdown: "Drawdown",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="h-5 w-5 text-[color:var(--brand-cyan)]" /> Alertes
          </h1>
          <p className="text-sm text-muted-foreground">
            Surveillance en temps réel — ticks Deriv live.
          </p>
        </div>
        {notifPerm !== "granted" && (
          <Button variant="outline" size="sm" onClick={requestNotif} className="gap-2">
            <BellRing className="h-4 w-4" />
            Activer les notifications
          </Button>
        )}
        {notifPerm === "granted" && (
          <span className="flex items-center gap-1.5 text-xs text-[color:var(--bull)]">
            <CheckCircle2 className="h-3.5 w-3.5" /> Notifications actives
          </span>
        )}
      </div>

      {/* Nouvelle alerte */}
      <div className="glass-panel rounded-xl p-4">
        <h3 className="text-sm font-semibold">Nouvelle alerte</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as Alert["type"])}>
            <option value="price">Prix atteint</option>
            <option value="signal">Signal IA</option>
            <option value="drawdown">Drawdown dépassé</option>
          </select>
          <select className="input" value={pair} onChange={(e) => setPair(e.target.value)}>
            <option>Portfolio</option>
            {SYMBOLS.map((s) => (
              <option key={s.deriv}>{s.label}</option>
            ))}
          </select>
          <select className="input" value={condition} onChange={(e) => setCondition(e.target.value)}>
            {type === "signal" ? (
              <>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </>
            ) : (
              <>
                <option value=">">supérieur à</option>
                <option value="<">inférieur à</option>
              </>
            )}
          </select>
          <input
            type="number"
            className="input"
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            placeholder="Valeur"
            disabled={type === "signal"}
          />
          <Button onClick={add} className="bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] font-semibold">
            <Plus className="mr-2 h-4 w-4" /> Créer
          </Button>
        </div>
        <style>{`.input { border-radius:6px; border:1px solid var(--border); background: var(--background); padding: 8px 12px; font-size: 14px; color: var(--foreground); width:100%; }`}</style>
      </div>

      {/* Liste */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left">Type</th>
              <th className="px-4 py-2.5 text-left">Cible</th>
              <th className="px-4 py-2.5 text-left">Condition</th>
              <th className="px-4 py-2.5 text-left">Prix live</th>
              <th className="px-4 py-2.5 text-right">Active</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Aucune alerte configurée
                </td>
              </tr>
            )}
            {items.map((a) => {
              const { price, triggered } = liveStatus(a);
              return (
                <tr key={a.id} className={cn("border-t border-border/40 transition-colors", triggered && a.enabled && "bg-[color:var(--bull)]/5")}>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                      a.type === "price" ? "bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]"
                        : a.type === "drawdown" ? "bg-[color:var(--bear)]/10 text-[color:var(--bear)]"
                        : "bg-[color:var(--brand-violet)]/10 text-[color:var(--brand-violet)]"
                    )}>
                      {TYPE_LABEL[a.type]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{a.pair}</td>
                  <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">
                    {a.type === "signal" ? a.condition : `${a.condition} ${a.value.toLocaleString()}`}
                  </td>
                  <td className="px-4 py-2.5">
                    {price !== null ? (
                      <span className={cn("font-mono text-xs font-semibold flex items-center gap-1",
                        triggered ? "text-[color:var(--bull)]" : "text-foreground"
                      )}>
                        <Wifi className="h-3 w-3 text-[color:var(--brand-cyan)]" />
                        {price.toLocaleString(undefined, { maximumFractionDigits: 5 })}
                        {triggered && " ✓"}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Switch checked={a.enabled} onCheckedChange={() => toggleAlert(a.id)} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => removeAlert(a.id)}
                      className="text-[color:var(--bear)] hover:text-[color:var(--bear)]">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog state={confirmState} />
    </div>
  );
}