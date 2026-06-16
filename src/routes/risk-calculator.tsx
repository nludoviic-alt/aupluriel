import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Calculator, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/risk-calculator")({
  head: () => ({ meta: [{ title: "Calculateur de Risk — LIO23" }] }),
  component: RiskCalculatorPage,
});

function RiskCalculatorPage() {
  const [balance, setBalance] = useState(1000);
  const [riskPct, setRiskPct] = useState(2);
  const [slPct, setSlPct] = useState(1.5);
  const [tpRatio, setTpRatio] = useState(2);
  const [winRate, setWinRate] = useState(58);

  const calc = useMemo(() => {
    const riskUsd = (balance * riskPct) / 100;
    const positionSize = slPct > 0 ? riskUsd / (slPct / 100) : 0;
    const tpPct = slPct * tpRatio;
    const tpUsd = positionSize * (tpPct / 100);
    const rrr = tpRatio;
    const expectancy = (winRate / 100) * tpUsd - ((100 - winRate) / 100) * riskUsd;
    const kelly = winRate / 100 - (1 - winRate / 100) / tpRatio;
    const kellyPct = Math.max(0, kelly * 100);
    const maxLosses = Math.floor(Math.log(0.5) / Math.log(1 - riskPct / 100));
    return { riskUsd, positionSize, tpPct, tpUsd, rrr, expectancy, kellyPct, maxLosses };
  }, [balance, riskPct, slPct, tpRatio, winRate]);

  const riskLevel =
    riskPct > 5 ? "danger" : riskPct > 3 ? "warn" : "safe";

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Calculator className="h-5 w-5 text-[color:var(--brand-cyan)]" />
          Calculateur de Risk
        </h1>
        <p className="text-sm text-muted-foreground">
          Optimise ta mise par trade selon ton capital et ton appétit au risque.
        </p>
      </div>

      {/* Inputs */}
      <div className="glass-panel rounded-xl p-5 grid gap-5 sm:grid-cols-2">
        <Field label="Capital du compte ($)">
          <NumInput value={balance} onChange={setBalance} min={10} max={1000000} step={100} />
        </Field>
        <Field label={`Risque par trade (${riskPct}%)`}>
          <input type="range" min={0.5} max={10} step={0.5} value={riskPct}
            onChange={(e) => setRiskPct(Number(e.target.value))}
            className="w-full accent-[color:var(--brand-cyan)]" />
          <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
            <span>0.5% (conservateur)</span><span>10% (très risqué)</span>
          </div>
        </Field>
        <Field label={`Stop Loss (${slPct}% du prix)`}>
          <input type="range" min={0.5} max={10} step={0.25} value={slPct}
            onChange={(e) => setSlPct(Number(e.target.value))}
            className="w-full accent-[color:var(--brand-violet)]" />
          <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
            <span>0.5%</span><span>10%</span>
          </div>
        </Field>
        <Field label={`Ratio Risque/Récompense (1:${tpRatio})`}>
          <input type="range" min={1} max={5} step={0.5} value={tpRatio}
            onChange={(e) => setTpRatio(Number(e.target.value))}
            className="w-full accent-[color:var(--brand-cyan)]" />
          <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
            <span>1:1</span><span>1:5</span>
          </div>
        </Field>
        <Field label={`Win Rate estimé (${winRate}%)`}>
          <input type="range" min={30} max={90} step={1} value={winRate}
            onChange={(e) => setWinRate(Number(e.target.value))}
            className="w-full accent-[color:var(--brand-cyan)]" />
          <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
            <span>30%</span><span>90%</span>
          </div>
        </Field>
      </div>

      {/* Risk level warning */}
      {riskLevel !== "safe" && (
        <div className={cn(
          "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
          riskLevel === "danger"
            ? "border-[color:var(--bear)]/40 bg-[color:var(--bear)]/10 text-[color:var(--bear)]"
            : "border-amber-500/40 bg-amber-500/10 text-amber-400"
        )}>
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          {riskLevel === "danger"
            ? `Risque de ${riskPct}% par trade est très élevé — tu peux ruiner ton compte en ${calc.maxLosses} pertes consécutives.`
            : `Risque de ${riskPct}% est au-dessus du seuil recommandé (2%). Envisage de réduire.`}
        </div>
      )}

      {/* Results */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ResultCard
          label="Risque par trade"
          value={`$${calc.riskUsd.toFixed(2)}`}
          sub={`${riskPct}% du capital`}
          tone={riskLevel === "safe" ? "bull" : riskLevel === "warn" ? "amber" : "bear"}
        />
        <ResultCard
          label="Taille de position"
          value={`$${calc.positionSize.toFixed(2)}`}
          sub={`SL à ${slPct}%`}
          tone="cyan"
        />
        <ResultCard
          label="Take Profit cible"
          value={`$${calc.tpUsd.toFixed(2)}`}
          sub={`${calc.tpPct.toFixed(2)}% · RRR 1:${tpRatio}`}
          tone="bull"
        />
        <ResultCard
          label="Espérance / trade"
          value={`${calc.expectancy >= 0 ? "+" : ""}$${calc.expectancy.toFixed(2)}`}
          sub={calc.expectancy > 0 ? "Stratégie rentable" : "Stratégie perdante"}
          tone={calc.expectancy >= 0 ? "bull" : "bear"}
        />
      </div>

      {/* Kelly & Breakdown */}
      <div className="glass-panel rounded-xl p-5 grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold mb-3">Critère de Kelly</h3>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold tracking-tight text-[color:var(--brand-cyan)]">
              {calc.kellyPct.toFixed(1)}%
            </span>
            <span className="text-sm text-muted-foreground mb-1">du capital suggéré</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted/30">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] transition-all"
              style={{ width: `${Math.min(100, calc.kellyPct * 5)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Kelly recommande de ne jamais dépasser{" "}
            <strong className="text-foreground">{calc.kellyPct.toFixed(1)}%</strong> par trade avec ces paramètres.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-3">Résistance aux pertes</h3>
          <div className="space-y-2">
            {[
              { label: "Pertes pour perdre 10%", n: Math.floor(Math.log(0.9) / Math.log(1 - riskPct / 100)) },
              { label: "Pertes pour perdre 25%", n: Math.floor(Math.log(0.75) / Math.log(1 - riskPct / 100)) },
              { label: "Pertes pour perdre 50%", n: calc.maxLosses },
            ].map(({ label, n }) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className={cn("font-semibold", n <= 5 ? "text-[color:var(--bear)]" : n <= 15 ? "text-amber-400" : "text-[color:var(--bull)]")}>
                  {n} trades
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Basé sur des pertes consécutives sans gain.
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, min, max, step }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min} max={max} step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
    />
  );
}

function ResultCard({ label, value, sub, tone }: {
  label: string; value: string; sub?: string;
  tone: "bull" | "bear" | "cyan" | "violet" | "amber";
}) {
  const cls = {
    bull: "text-[color:var(--bull)]",
    bear: "text-[color:var(--bear)]",
    cyan: "text-[color:var(--brand-cyan)]",
    violet: "text-[color:var(--brand-violet)]",
    amber: "text-amber-400",
  }[tone];
  return (
    <div className="glass-panel rounded-xl p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tracking-tight", cls)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
