import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clipboard,
  Check,
  Code2,
  Crosshair,
  FlaskConical,
  Gauge,
  RefreshCcw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/skills")({
  head: () => ({ meta: [{ title: "Skills AI — Au Pluriel" }] }),
  component: SkillsPage,
});

type SkillCategory = "all" | "tune" | "audit" | "security" | "intelligence";

interface SkillItem {
  name: string;
  title: string;
  category: "tune" | "audit" | "security" | "intelligence";
  categoryLabel: string;
  description: string;
  prompt: string;
  icon: any;
  tone: "sky" | "emerald" | "amber" | "purple" | "rose" | "cyan";
  capabilities: string[];
}

const ACTIVE_SKILLS: readonly SkillItem[] = [
  {
    name: "audit-trading-production",
    title: "Audit Trading Production",
    category: "audit",
    categoryLabel: "Audit & Bilan",
    description: "Analyse en lecture seule le rendement réel, le risque, les segments et les configurations chargées sur le VPS.",
    prompt: "Utilise $audit-trading-production pour auditer les performances du bot en production.",
    icon: BarChart3,
    tone: "emerald",
    capabilities: ["P&L, PF et espérance", "Boom, Crash et Multi", "Confiance, TF et heures", "Contrôle des configurations"],
  },
  {
    name: "tune-boom-preset",
    title: "Optimisation Boom",
    category: "tune",
    categoryLabel: "Optimisation",
    description: "Teste les paramètres Boom sur des bougies Deriv réelles avec le même moteur de replay que l’application.",
    prompt: "Utilise $tune-boom-preset pour optimiser Boom avec des données réelles.",
    icon: FlaskConical,
    tone: "amber",
    capabilities: ["Sweep TP et SL", "Confiance et accord TF", "Levier et durée", "Détail par symbole"],
  },
  {
    name: "tune-crash-preset",
    title: "Optimisation Crash",
    category: "tune",
    categoryLabel: "Optimisation",
    description: "Même moteur de sweep que Boom, réglé sur CRASH1000/500/600/900 — walk-forward sur bougies Deriv réelles.",
    prompt: "Utilise $tune-crash-preset pour optimiser Crash avec des données réelles.",
    icon: Sparkles,
    tone: "amber",
    capabilities: ["Sweep TP et SL", "Confiance et accord TF", "Levier et durée", "Détail par symbole"],
  },
  {
    name: "tune-multi-preset",
    title: "Optimisation Multi",
    category: "tune",
    categoryLabel: "Optimisation",
    description: "Sweep confiance/accord TF pour le preset Multi (forex + or + BTC) avec le même moteur binaire CALL/PUT que l’auto-backtest en production.",
    prompt: "Utilise $tune-multi-preset pour optimiser Multi avec des données réelles.",
    icon: BrainCircuit,
    tone: "purple",
    capabilities: ["Confiance et accord TF", "Moteur binaire CALL/PUT", "Détail par symbole", "Comparaison au seuil de rentabilité"],
  },
  {
    name: "tune-scalping-preset",
    title: "Optimisation Scalping",
    category: "tune",
    categoryLabel: "Optimisation",
    description: "Sweep de paramètres dédié au mode Scalping à fréquence élevée sur bougies rapides Deriv.",
    prompt: "Utilise $tune-scalping-preset pour optimiser les réglages du mode Scalping.",
    icon: Rocket,
    tone: "sky",
    capabilities: ["TP et SL serrés", "Fréquence d'exécution", "Confiance et filtres", "Calcul d'espérance rapide"],
  },
  {
    name: "verify-trading-code",
    title: "Vérification du moteur",
    category: "audit",
    categoryLabel: "Audit & Bilan",
    description: "Contrôle en lecture seule : configs réellement utilisées, dérive frontend/API/serveur, régressions de preset, calculs P&L/PF/espérance, cohérence entre pages.",
    prompt: "Utilise $verify-trading-code pour vérifier la cohérence du moteur de trading.",
    icon: Code2,
    tone: "emerald",
    capabilities: ["Configs vs. code serveur", "Détection de dérive", "Calculs P&L/PF/espérance", "Cohérence inter-pages"],
  },
  {
    name: "production-trading-guardian",
    title: "Gardien Production",
    category: "security",
    categoryLabel: "Sécurité",
    description: "Procédure de sécurité pour un déploiement touchant le moteur : sauvegarde, vérification du build, confirmation du redémarrage des bots, comparaison avant/après.",
    prompt: "Utilise $production-trading-guardian pour sécuriser un déploiement touchant le moteur de trading.",
    icon: ShieldCheck,
    tone: "emerald",
    capabilities: ["Pré-vol : build + migrations", "Sauvegarde avant déploiement", "Confirmation des bots restaurés", "Comparaison 20/50/100 trades"],
  },
  {
    name: "config-change-impact",
    title: "Impact des changements",
    category: "security",
    categoryLabel: "Sécurité",
    description: "S'appuie sur la table config_changes : compare automatiquement les trades avant vs. après chaque modification de preset avec rollback automatique opt-in.",
    prompt: "Utilise $config-change-impact pour comparer les performances avant et après les derniers changements de configuration.",
    icon: RefreshCcw,
    tone: "sky",
    capabilities: ["Avant/après par changement", "Espérance et profit factor", "Rollback automatique opt-in", "Par utilisateur et preset"],
  },
  {
    name: "adaptive-trading-optimizer",
    title: "Cerveau Adaptatif",
    category: "intelligence",
    categoryLabel: "Intelligence",
    description: "Apprend des erreurs de trades, classifie les pertes par cause racine, découvre les patterns gagnants (zones d'or), optimise automatiquement les paramètres et cherche à approcher 90% de win rate. Se documente dans un journal persistant.",
    prompt: "Utilise $adaptive-trading-optimizer pour analyser toutes les données de trading et optimiser automatiquement les paramètres.",
    icon: BrainCircuit,
    tone: "purple",
    capabilities: ["Classification des erreurs (10 causes)", "Zones d'or (WR ≥ 70%)", "Sweep confiance/TF/symboles/heures", "Journal persistant + progression vers 90%"],
  },
  {
    name: "daily-pnl-review",
    title: "Revue Quotidienne",
    category: "intelligence",
    categoryLabel: "Intelligence",
    description: "Analyse quotidienne des trades de la veille — identifie les pertes évitables, les symboles à suspendre, et recommande les ajustements pour aujourd'hui. Compare avec la moyenne des 7 derniers jours.",
    prompt: "Utilise $daily-pnl-review pour analyser les trades d'hier et recommander des ajustements.",
    icon: TrendingUp,
    tone: "emerald",
    capabilities: ["P&L par preset/symbole/heure", "Comparaison vs 7 jours", "Plus grosses pertes + streaks", "Changements de config du jour"],
  },
  {
    name: "risk-optimizer",
    title: "Optimiseur de Risque",
    category: "intelligence",
    categoryLabel: "Intelligence",
    description: "Optimise la taille de position avec le critère de Kelly fractionnel — maximise la croissance tout en limitant le drawdown. Inclut stress tests et limites de perte quotidiennes.",
    prompt: "Utilise $risk-optimizer pour calculer la mise optimale et les limites de risque.",
    icon: Gauge,
    tone: "rose",
    capabilities: ["Kelly fractionnel par preset", "Mise recommandée vs actuelle", "Stress tests (5/10/20 pertes)", "Limites quotidienne/hebdomadaire"],
  },
  {
    name: "session-timing-analyzer",
    title: "Analyseur de Sessions",
    category: "intelligence",
    categoryLabel: "Intelligence",
    description: "Analyse quelles heures et sessions de trading (Asia, London, New York) sont les plus rentables historiquement. Heatmap heure × jour de la semaine.",
    prompt: "Utilise $session-timing-analyzer pour trouver les meilleures heures et sessions de trading.",
    icon: Target,
    tone: "amber",
    capabilities: ["Par heure UTC (24h)", "Par session (Asia/London/NY)", "Heatmap heure × jour", "Fenêtres recommandées"],
  },
  {
    name: "backtest-vs-live-validator",
    title: "Backtest vs Live",
    category: "intelligence",
    categoryLabel: "Intelligence",
    description: "Compare les promesses du backtest avec les résultats réels en production — détecte si le bot sous-performe et pourquoi (slippage, exécution, config drift).",
    prompt: "Utilise $backtest-vs-live-validator pour comparer le backtest avec les résultats live.",
    icon: Crosshair,
    tone: "cyan",
    capabilities: ["Écart win rate backtest/live", "Causes probables d'écart", "Par preset et symbole", "Verdict fiable/non fiable"],
  },
];

function SkillsPage() {
  const { user } = useAuth();
  const isAdmin = user?.is_admin === 1;
  const [selectedCategory, setSelectedCategory] = useState<SkillCategory>("all");
  const [copiedName, setCopiedName] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 shadow-[0_0_20px_rgba(244,63,94,0.15)]">
          <Wrench className="h-7 w-7 text-rose-400" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Accès réservé</h2>
        <p className="mt-2 text-sm text-muted-foreground">Cette page est réservée aux administrateurs.</p>
      </div>
    );
  }

  async function copyPrompt(skill: SkillItem) {
    await navigator.clipboard.writeText(skill.prompt);
    setCopiedName(skill.name);
    toast.success(`Commande copiée : $${skill.name}`);
    setTimeout(() => setCopiedName(null), 2000);
  }

  const filteredSkills = ACTIVE_SKILLS.filter(
    (s) => selectedCategory === "all" || s.category === selectedCategory
  );

  const categories = [
    { id: "all", label: "Toutes les procédures", count: ACTIVE_SKILLS.length },
    { id: "intelligence", label: "Intelligence & Optimisation", count: ACTIVE_SKILLS.filter((s) => s.category === "intelligence").length },
    { id: "tune", label: "Optimisations & Sweeps", count: ACTIVE_SKILLS.filter((s) => s.category === "tune").length },
    { id: "audit", label: "Audits & Contrôle", count: ACTIVE_SKILLS.filter((s) => s.category === "audit").length },
    { id: "security", label: "Sécurité & Déploiement", count: ACTIVE_SKILLS.filter((s) => s.category === "security").length },
  ] as const;

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 px-4 py-6 md:px-8 lg:px-12">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-sky-500/10 via-black/40 to-black/60 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-500/30 bg-sky-500/15 text-sky-300 shadow-[0_0_20px_rgba(56,189,248,0.2)]">
              <Wrench className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black text-foreground md:text-3xl">Skills AI</h1>
                <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase text-sky-300">
                  {ACTIVE_SKILLS.length} actifs
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground max-w-2xl leading-relaxed">
                Procédures d'intelligence artificielle sur mesure pour auditer les résultats SQLite, optimiser les stratégies sur bougies Deriv réelles et sécuriser la production.
              </p>
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-3 gap-2 shrink-0 border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-6 text-center">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Optimisation</div>
              <div className="mt-1 font-mono text-base font-black text-amber-400">4</div>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Audits</div>
              <div className="mt-1 font-mono text-base font-black text-emerald-400">2</div>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sécurité</div>
              <div className="mt-1 font-mono text-base font-black text-sky-400">2</div>
            </div>
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id as SkillCategory)}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition-all duration-200 shrink-0 touch-manipulation active:scale-[0.98]",
              selectedCategory === cat.id
                ? "border-sky-500/50 bg-sky-500/15 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.2)]"
                : "border-white/10 bg-card/40 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
            )}
          >
            <span>{cat.label}</span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.2 text-[10px] font-mono font-black",
                selectedCategory === cat.id ? "bg-sky-500/30 text-sky-200" : "bg-white/10 text-muted-foreground"
              )}
            >
              {cat.count}
            </span>
          </button>
        ))}
      </div>

      {/* Skills Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {filteredSkills.map((skill) => {
          const isCopied = copiedName === skill.name;
          const toneStyles = {
            sky: "border-sky-500/30 bg-sky-500/10 text-sky-300",
            emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
            amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
            purple: "border-purple-500/30 bg-purple-500/10 text-purple-300",
            rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
            cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
          }[skill.tone];

          return (
            <div
              key={skill.name}
              className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-5 transition-all duration-200 hover:border-white/20 hover:bg-card/60 shadow-lg space-y-4"
            >
              {/* Card Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-sm", toneStyles)}>
                    <skill.icon className="h-5.5 w-5.5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-black text-foreground truncate">{skill.title}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-mono text-[11px] font-semibold text-muted-foreground/80">${skill.name}</span>
                      <span className="rounded bg-white/[0.06] px-1.5 py-0.2 text-[9px] font-bold text-muted-foreground uppercase">
                        {skill.categoryLabel}
                      </span>
                    </div>
                  </div>
                </div>

                <span className="inline-flex items-center gap-1 shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-300 shadow-sm">
                  <CheckCircle2 className="h-3 w-3" /> Actif
                </span>
              </div>

              {/* Description */}
              <p className="text-xs leading-relaxed text-muted-foreground">{skill.description}</p>

              {/* Capabilities Grid */}
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/[0.06] bg-black/40 p-3 text-xs">
                {skill.capabilities.map((cap) => (
                  <div key={cap} className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/90">
                    <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                    <span className="truncate">{cap}</span>
                  </div>
                ))}
              </div>

              {/* Interactive Copy Prompt Bar */}
              <div
                onClick={() => void copyPrompt(skill)}
                className="group/btn flex items-center justify-between gap-2 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] p-2.5 transition-all duration-200 cursor-pointer hover:border-sky-500/40 hover:bg-sky-500/[0.12] active:scale-[0.99]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[10px] font-black uppercase tracking-wider text-sky-400 shrink-0">PROMPT</span>
                  <code className="truncate text-xs font-mono text-sky-200">{skill.prompt}</code>
                </div>
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/20 text-sky-300 transition-colors group-hover/btn:bg-sky-500/30"
                >
                  {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Clipboard className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Safety Note */}
      <div className="flex items-start gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.05] p-4 text-xs text-muted-foreground shadow-md">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
        <p className="leading-relaxed">
          <strong className="text-foreground">Utilisation responsable des Skills AI :</strong> Les procédures spécialisées garantissent la rigueur des audits, la précision des sweeps de backtest et la sécurité des déploiements. Elles s'exécutent en conformité avec les règles de gestion du risque configurées.
        </p>
      </div>
    </div>
  );
}
