import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getOpenPositions,
  getProfitTable,
  sellContractNow,
  subscribeContract,
  SYMBOLS,
  type OpenPosition,
  type ProfitRecord,
} from "@/lib/deriv";
import { useDerivSession } from "@/hooks/use-deriv-session";
import { cn } from "@/lib/utils";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { LiveTradeCard } from "@/components/live-trade-card";

export const Route = createFileRoute("/portfolio")({
  head: () => ({ meta: [{ title: "Portfolio — LIO23" }] }),
  component: PortfolioPage,
});

function useDerivAuth() {
  const session = useDerivSession();
  return {
    ready: session.connected,
    balance: session.balance,
    currency: session.currency,
  };
}

function usePortfolio() {
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [profits, setProfits] = useState<ProfitRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const unsubsRef = useRef<Map<number, () => void>>(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
    const [pos, prof] = await Promise.all([getOpenPositions(), getProfitTable(30)]);
    setPositions(pos);
    setProfits(prof);
    setLoading(false);

    // Subscribe to live P&L for each open position
    pos.forEach((p) => {
      if (unsubsRef.current.has(p.contractId)) return;
      const unsub = subscribeContract(p.contractId, (update) => {
        setPositions((prev) =>
          prev.map((x) =>
            x.contractId === update.contractId
              ? { ...x, profit: update.profit, currentSpot: update.currentSpot }
              : x,
          ),
        );
        if (update.status === "won" || update.status === "lost") {
          setPositions((prev) => prev.filter((x) => x.contractId !== update.contractId));
          unsubsRef.current.get(update.contractId)?.();
          unsubsRef.current.delete(update.contractId);
          refresh();
        }
      });
      unsubsRef.current.set(p.contractId, unsub);
    });
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      for (const unsub of unsubsRef.current.values()) unsub();
    };
  }, [refresh]);

  async function close(contractId: number) {
    try {
      const soldFor = await sellContractNow(contractId);
      toast.success(`Position fermée — vendue ${soldFor.toFixed(2)}`);
      unsubsRef.current.get(contractId)?.();
      unsubsRef.current.delete(contractId);
      setPositions((prev) => prev.filter((p) => p.contractId !== contractId));
      setTimeout(refresh, 1500);
    } catch (e) {
      toast.error(`Fermeture échouée: ${(e as Error).message}`);
    }
  }

  return { positions, profits, loading, refresh, close };
}

function symbolLabel(derivSym: string) {
  return SYMBOLS.find((s) => s.deriv === derivSym)?.label ?? derivSym;
}

function timeLeft(expiryEpoch: number) {
  const secs = expiryEpoch - Math.floor(Date.now() / 1000);
  if (secs <= 0) return "Expiré";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function TimeLeft({ expiry }: { expiry: number }) {
  const [label, setLabel] = useState(() => timeLeft(expiry));
  useEffect(() => {
    const id = setInterval(() => setLabel(timeLeft(expiry)), 1000);
    return () => clearInterval(id);
  }, [expiry]);
  return <span>{label}</span>;
}

function pnlToday(profits: ProfitRecord[]) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const ts = todayStart.getTime() / 1000;
  return profits
    .filter((p) => p.sellTime >= ts)
    .reduce((acc, p) => acc + p.profit, 0);
}

export default function PortfolioPage() {
  const { ready, balance, currency } = useDerivAuth();
  const { positions, profits, loading, refresh, close } = usePortfolio();
  const { confirmState, confirm } = useConfirm();

  const todayPnl = pnlToday(profits);
  const openPnl = positions.reduce((acc, p) => acc + p.profit, 0);
  const totalPnl = todayPnl + openPnl;

  const noToken = !localStorage.getItem("lio23.deriv_token");

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Portfolio</h1>
          <p className="text-xs text-muted-foreground">
            Positions ouvertes et P&L en temps réel via Deriv.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} />
          Actualiser
        </Button>
      </div>

      {noToken && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-400">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-400">Token Deriv manquant</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Configure ton token API Deriv pour accéder aux positions réelles, au solde live et à l'historique des trades.
            </p>
            <a
              href="/settings"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
            >
              Configurer dans Paramètres →
            </a>
          </div>
        </div>
      )}

      {!noToken && ready && (
        <div className="flex items-center gap-2 text-xs text-[color:var(--bull)]">
          <span className="h-2 w-2 rounded-full bg-[color:var(--bull)] animate-pulse" />
          Connecté à Deriv · données en temps réel
        </div>
      )}
      {!noToken && !ready && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Connexion à Deriv…
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiBox
          label={`Balance (${currency})`}
          value={balance !== null ? balance.toFixed(2) : "—"}
          icon={<Wallet className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiBox
          label="P&L positions ouvertes"
          value={openPnl >= 0 ? `+${openPnl.toFixed(2)}` : openPnl.toFixed(2)}
          icon={<TrendingUp className="h-4 w-4" />}
          tone={openPnl >= 0 ? "bull" : "bear"}
        />
        <KpiBox
          label="P&L du jour (fermés)"
          value={todayPnl >= 0 ? `+${todayPnl.toFixed(2)}` : todayPnl.toFixed(2)}
          icon={todayPnl >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
          tone={todayPnl >= 0 ? "bull" : "bear"}
        />
        <KpiBox
          label="P&L total aujourd'hui"
          value={totalPnl >= 0 ? `+${totalPnl.toFixed(2)}` : totalPnl.toFixed(2)}
          icon={<TrendingDown className="h-4 w-4" />}
          tone={totalPnl >= 0 ? "bull" : "bear"}
        />
      </div>

      {/* Live position visuals */}
      {positions.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[color:var(--brand-cyan)] animate-pulse" />
            <h2 className="text-base font-semibold">Mouvement en direct</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {positions.map((p) => (
              <LiveTradeCard
                key={p.contractId}
                trade={{
                  id: String(p.contractId),
                  symbol: p.symbol,
                  direction: p.contractType === "PUT" ? "PUT" : "CALL",
                  stake: p.buyPrice,
                  expiry: p.dateExpiry * 1000,
                  liveProfit: p.profit,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Open positions */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Positions ouvertes{" "}
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {positions.length}
            </span>
          </h2>
          {!ready && !noToken && (
            <span className="text-xs text-muted-foreground animate-pulse">Connexion Deriv…</span>
          )}
        </div>
        <table className="w-full">
          <thead className="bg-muted/20 text-xs font-semibold text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left">Actif</th>
              <th className="px-4 py-2.5 text-left">Direction</th>
              <th className="px-4 py-2.5 text-right">Mise</th>
              <th className="px-4 py-2.5 text-right">Spot actuel</th>
              <th className="px-4 py-2.5 text-right">P&L</th>
              <th className="px-4 py-2.5 text-right">Expiration</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[11px] text-muted-foreground">
                  {ready ? "Aucune position ouverte" : noToken ? "Token requis" : "Chargement…"}
                </td>
              </tr>
            )}
            {positions.map((p) => (
              <tr key={p.contractId} className="border-t border-border/40 hover:bg-muted/10 transition-colors">
                <td className="px-4 py-3 font-medium text-xs">{symbolLabel(p.symbol)}</td>
                <td className="px-4 py-3 text-xs">
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-semibold",
                      p.contractType === "CALL"
                        ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                        : "bg-[color:var(--bear)]/10 text-[color:var(--bear)]",
                    )}
                  >
                    {p.contractType === "CALL" ? "▲ CALL" : "▼ PUT"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">{p.buyPrice.toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground text-xs">
                  {p.currentSpot > 0 ? p.currentSpot.toFixed(p.symbol.startsWith("frx") ? 5 : 2) : "—"}
                </td>
                <td
                  className={cn(
                    "px-4 py-3 text-right font-mono font-semibold text-xs",
                    p.profit >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]",
                  )}
                >
                  {p.profit >= 0 ? "+" : ""}
                  {p.profit.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground text-[10px]">
                  <span className="flex items-center justify-end gap-1">
                    <Clock className="h-3 w-3" />
                    <TimeLeft expiry={p.dateExpiry} />
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Fermer la position ?",
                        description: `Vendre ${symbolLabel(p.symbol)} (${p.contractType}) maintenant au prix du marché. P&L actuel : ${p.profit >= 0 ? "+" : ""}${p.profit.toFixed(2)}.`,
                        confirmLabel: "Fermer",
                        danger: p.profit < 0,
                      });
                      if (ok) close(p.contractId);
                    }}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-[color:var(--bear)]"
                    title="Fermer la position"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent closed trades */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40">
          <h2 className="text-sm font-semibold">Trades fermés récents</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left">Actif</th>
              <th className="px-4 py-2.5 text-left">Type</th>
              <th className="px-4 py-2.5 text-right">Achat</th>
              <th className="px-4 py-2.5 text-right">Vente</th>
              <th className="px-4 py-2.5 text-right">P&L</th>
              <th className="px-4 py-2.5 text-right">Heure</th>
            </tr>
          </thead>
          <tbody>
            {profits.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[11px] text-muted-foreground">
                  {ready ? "Aucun trade récent" : noToken ? "Token requis" : "Chargement…"}
                </td>
              </tr>
            )}
            {profits.slice(0, 20).map((t) => (
              <tr key={t.contractId} className="border-t border-border/40 hover:bg-muted/10 transition-colors">
                <td className="px-4 py-2.5 font-medium text-xs">{symbolLabel(t.symbol)}</td>
                <td className="px-4 py-2.5 text-xs">
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-semibold",
                      t.contractType === "CALL"
                        ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                        : "bg-[color:var(--bear)]/10 text-[color:var(--bear)]",
                    )}
                  >
                    {t.contractType}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground text-xs">
                  {t.buyPrice.toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground text-xs">
                  {t.sellPrice.toFixed(2)}
                </td>
                <td
                  className={cn(
                    "px-4 py-2.5 text-right font-mono font-semibold text-xs",
                    t.profit >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]",
                  )}
                >
                  {t.profit >= 0 ? "+" : ""}
                  {t.profit.toFixed(2)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                  {new Date(t.sellTime * 1000).toLocaleTimeString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog state={confirmState} />
    </div>
  );
}

function KpiBox({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "cyan" | "bull" | "bear" | "violet";
}) {
  const colors = {
    cyan: "text-[color:var(--brand-cyan)] border-[color:var(--brand-cyan)]/20 bg-[color:var(--brand-cyan)]/5",
    bull: "text-[color:var(--bull)] border-[color:var(--bull)]/20 bg-[color:var(--bull)]/5",
    bear: "text-[color:var(--bear)] border-[color:var(--bear)]/20 bg-[color:var(--bear)]/5",
    violet: "text-[color:var(--brand-violet)] border-[color:var(--brand-violet)]/20 bg-[color:var(--brand-violet)]/5",
  }[tone];

  return (
    <div className={cn("rounded-xl border p-4", colors)}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">{label}</span>
        <span className="opacity-60">{icon}</span>
      </div>
      <div className="mt-2 font-mono-tabular text-2xl font-bold leading-none">{value}</div>
    </div>
  );
}
