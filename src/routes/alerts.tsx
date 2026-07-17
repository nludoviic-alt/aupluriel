import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, BellRing, CheckCircle2, Loader2, Plus, Trash2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { SYMBOLS, subscribeTicks } from "@/lib/deriv";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { getExistingPushSubscription, isPushSupported, subscribeToPush } from "@/lib/push";

export const Route = createFileRoute("/alerts")({
  head: () => ({ meta: [{ title: "Alertes — PLURIEL" }] }),
  component: AlertsPage,
});

interface Alert {
  id: string;
  type: "price" | "drawdown";
  pair: string;
  symbol: string | null;
  condition: string;
  value: number;
  enabled: boolean;
}

const TYPE_LABEL: Record<Alert["type"], string> = {
  price: "Prix",
  drawdown: "Drawdown",
};

function AlertsPage() {
  const [items, setItems] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<Alert["type"]>("price");
  const { confirmState, confirm } = useConfirm();
  const [pair, setPair] = useState("BTC/USD");
  const [condition, setCondition] = useState(">");
  const [value, setValue] = useState(0);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<{ alerts: Alert[] }>("/api/alerts");
      setItems(data.alerts);
    } catch {
      toast.error("Impossible de charger les alertes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const supported = isPushSupported();
    setPushSupported(supported);
    if (supported) getExistingPushSubscription().then((sub) => setPushEnabled(!!sub)).catch(() => {});
  }, []);

  // Live ticks for the "prix live" column only — the alert itself is checked
  // server-side every minute (price-alerts.server.ts) so it fires via push
  // even with this page (or the app) closed.
  useEffect(() => {
    const pairs = [...new Set(
      items.filter((a) => a.enabled && a.type === "price" && a.symbol).map((a) => a.symbol as string)
    )];
    const unsubs = pairs.map((deriv) =>
      subscribeTicks(deriv, (tick) => {
        setLivePrices((prev) => ({ ...prev, [deriv]: tick.quote }));
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [items]);

  async function handleEnablePush() {
    try {
      await subscribeToPush();
      setPushEnabled(true);
      toast.success("Notifications push activées !");
    } catch (err: any) {
      toast.error(err.message || "Impossible d'activer les notifications");
    }
  }

  async function add() {
    const symbol = type === "price" ? SYMBOLS.find((s) => s.label === pair)?.deriv ?? null : null;
    if (type === "price" && !symbol) {
      toast.error("Paire invalide.");
      return;
    }
    try {
      const data = await api.post<{ alert: Alert }>("/api/alerts", {
        type,
        pair: type === "drawdown" ? "Portfolio" : pair,
        symbol,
        condition,
        value,
      });
      setItems((prev) => [data.alert, ...prev]);
      toast.success("Alerte créée — vérifiée chaque minute, même app fermée");
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de la création");
    }
  }

  async function removeAlert(id: string) {
    const a = items.find((i) => i.id === id);
    const ok = await confirm({
      title: "Supprimer l'alerte ?",
      description: `Alerte "${a ? TYPE_LABEL[a.type] : ""}" sur ${a?.pair} sera définitivement supprimée.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete("/api/alerts", { id });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de la suppression");
    }
  }

  async function toggleAlert(id: string) {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    const nextEnabled = !current.enabled;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, enabled: nextEnabled } : i)));
    try {
      await api.patch("/api/alerts", { id, enabled: nextEnabled });
    } catch (err: any) {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, enabled: !nextEnabled } : i)));
      toast.error(err.message || "Erreur lors de la mise à jour");
    }
  }

  function liveStatus(a: Alert): { price: number | null; triggered: boolean } {
    if (a.type !== "price" || !a.symbol) return { price: null, triggered: false };
    const price = livePrices[a.symbol] ?? null;
    if (price === null) return { price: null, triggered: false };
    const triggered =
      (a.condition === ">" && price > a.value) ||
      (a.condition === "<" && price < a.value);
    return { price, triggered };
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="h-5 w-5 text-[color:var(--brand-cyan)]" /> Alertes
          </h1>
          <p className="text-sm text-muted-foreground">
            Vérifiées côté serveur chaque minute — reçues même app fermée.
          </p>
        </div>
        {pushSupported && !pushEnabled && (
          <Button variant="outline" size="sm" onClick={handleEnablePush} className="gap-2">
            <BellRing className="h-4 w-4" />
            Activer les notifications
          </Button>
        )}
        {pushEnabled && (
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
            <option value="drawdown">Drawdown dépassé</option>
          </select>
          {type === "price" ? (
            <select className="input" value={pair} onChange={(e) => setPair(e.target.value)}>
              {SYMBOLS.map((s) => (
                <option key={s.deriv}>{s.label}</option>
              ))}
            </select>
          ) : (
            <select className="input" disabled value="Portfolio">
              <option>Portfolio</option>
            </select>
          )}
          <select className="input" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value=">">supérieur à</option>
            <option value="<">inférieur à</option>
          </select>
          <input
            type="number"
            className="input"
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            placeholder="Valeur"
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
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Aucune alerte configurée
                </td>
              </tr>
            ) : (
              items.map((a) => {
                const { price, triggered } = liveStatus(a);
                return (
                  <tr key={a.id} className={cn("border-t border-border/40 transition-colors", triggered && a.enabled && "bg-[color:var(--bull)]/5")}>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                        a.type === "price" ? "bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]" : "bg-[color:var(--bear)]/10 text-[color:var(--bear)]"
                      )}>
                        {TYPE_LABEL[a.type]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-medium">{a.pair}</td>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">
                      {a.condition} {a.value.toLocaleString()}
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
              })
            )}
          </tbody>
        </table>
      </div>
      <ConfirmDialog state={confirmState} />
    </div>
  );
}
