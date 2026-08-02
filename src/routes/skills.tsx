import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clipboard,
  Code2,
  FlaskConical,
  Rocket,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/skills")({
  head: () => ({ meta: [{ title: "Skills — Au Pluriel" }] }),
  component: SkillsPage,
});

const ACTIVE_SKILLS = [
  {
    name: "audit-trading-production",
    title: "Audit Trading Production",
    description: "Analyse en lecture seule le rendement réel, le risque, les segments et les configurations chargées sur le VPS.",
    prompt: "Utilise $audit-trading-production pour auditer les performances du bot en production.",
    icon: BarChart3,
    tone: "emerald",
    capabilities: ["P&L, PF et espérance", "Boom, Crash et Multi", "Confiance, TF et heures", "Contrôle des configurations"],
  },
  {
    name: "tune-boom-preset",
    title: "Optimisation Boom",
    description: "Teste les paramètres Boom sur des bougies Deriv réelles avec le même moteur de replay que l’application.",
    prompt: "Utilise $tune-boom-preset pour optimiser Boom avec des données réelles.",
    icon: FlaskConical,
    tone: "amber",
    capabilities: ["Sweep TP et SL", "Confiance et accord TF", "Levier et durée", "Détail par symbole"],
  },
] as const;

const PLANNED_SKILLS = [
  { name: "tune-crash-preset", title: "Optimisation Crash", description: "Walk-forward et recherche de paramètres pour CRASH900/1000.", icon: Sparkles },
  { name: "tune-multi-preset", title: "Optimisation Multi", description: "Validation séparée OTC, Forex et crypto sans mélanger leurs profils.", icon: BrainCircuit },
  { name: "verify-trading-code", title: "Vérification du moteur", description: "Contrôle frontend, API, serveur, calculs et régressions de configuration.", icon: Code2 },
  { name: "production-trading-guardian", title: "Gardien Production", description: "Sauvegarde, déploiement, restauration et comparaison avant/après.", icon: ShieldCheck },
] as const;

function SkillsPage() {
  const { user } = useAuth();
  const isAdmin = user?.is_admin === 1;

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10">
          <Wrench className="h-7 w-7 text-rose-400" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Accès réservé</h2>
        <p className="mt-2 text-sm text-muted-foreground">Cette page est réservée aux administrateurs.</p>
      </div>
    );
  }

  async function copyPrompt(prompt: string) {
    await navigator.clipboard.writeText(prompt);
    toast.success("Commande du skill copiée");
  }

  return (
    <div className="mx-auto max-w-screen-2xl space-y-7 px-4 py-6 md:px-8 lg:px-12">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-sky-300">
          <Wrench className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-black leading-none text-foreground md:text-2xl">Skills</h2>
          <p className="mt-1 text-xs text-muted-foreground">Procédures spécialisées utilisées pour auditer, tester et sécuriser le bot.</p>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3 border-b border-white/[0.07] pb-3">
          <div>
            <h3 className="text-sm font-black uppercase text-foreground">Disponibles</h3>
            <p className="mt-1 text-xs text-muted-foreground">Installés dans le projet et utilisables par Codex.</p>
          </div>
          <span className="font-mono text-xs font-bold text-emerald-300">{ACTIVE_SKILLS.length} actifs</span>
        </div>

        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {ACTIVE_SKILLS.map((skill) => (
            <article key={skill.name} className="min-w-0 overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                    skill.tone === "emerald"
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                      : "border-amber-500/20 bg-amber-500/10 text-amber-300",
                  )}>
                    <skill.icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-black text-foreground">{skill.title}</h4>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">${skill.name}</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[9px] font-black uppercase text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> Actif
                </span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{skill.description}</p>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-y border-white/[0.06] py-3">
                {skill.capabilities.map((capability) => (
                  <p key={capability} className="text-[11px] font-semibold text-foreground/80">{capability}</p>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-black/25 px-2.5 py-2 text-[10px] text-sky-200">{skill.prompt}</code>
                <button
                  type="button"
                  onClick={() => void copyPrompt(skill.prompt)}
                  aria-label={`Copier la commande ${skill.title}`}
                  title="Copier la commande"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  <Clipboard className="h-4 w-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="border-b border-white/[0.07] pb-3">
          <h3 className="text-sm font-black uppercase text-foreground">Feuille de route</h3>
          <p className="mt-1 text-xs text-muted-foreground">Prochains modules spécialisés, à construire et valider séparément.</p>
        </div>
        <div className="divide-y divide-white/[0.06]">
          {PLANNED_SKILLS.map((skill, index) => (
            <div key={skill.name} className="grid gap-3 py-4 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:items-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.025] text-muted-foreground">
                <skill.icon className="h-4 w-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-bold text-foreground">{skill.title}</h4>
                  <span className="font-mono text-[10px] text-muted-foreground">${skill.name}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
              </div>
              <span className="w-fit rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[9px] font-black uppercase text-muted-foreground">
                Étape {index + 2}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-start gap-3 border-t border-sky-500/15 pt-5 text-xs text-muted-foreground">
        <Rocket className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
        <p>Les skills améliorent la rigueur des audits et des déploiements. Ils ne garantissent pas un rendement financier et ne doivent jamais contourner les limites de risque.</p>
      </div>
    </div>
  );
}
