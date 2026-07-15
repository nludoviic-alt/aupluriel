// Admin bug/changelog tracker UI — shows what was found & fixed (history,
// seeded once from real git history) plus what's currently open or under
// watch, and lets an admin log new items going forward.
import { useCallback, useEffect, useState } from "react";
import { Bug, Plus, Trash2, Wrench, Sparkles, Eye } from "lucide-react";
import { CollapsibleBlock } from "@/components/collapsible-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "sonner";

type EntryType = "fix" | "improvement" | "watch";
type EntryStatus = "open" | "monitoring" | "resolved";

interface ChangelogEntry {
  id: number;
  type: EntryType;
  title: string;
  description: string;
  status: EntryStatus;
  createdAt: number;
  createdBy: string | null;
}

const TYPE_META: Record<EntryType, { label: string; icon: typeof Wrench; className: string }> = {
  fix: { label: "Bug corrigé", icon: Wrench, className: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20" },
  improvement: { label: "Amélioration", icon: Sparkles, className: "text-violet-400 bg-violet-500/10 border-violet-500/20" },
  watch: { label: "À surveiller", icon: Eye, className: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
};

const STATUS_META: Record<EntryStatus, { label: string; className: string }> = {
  open: { label: "Ouvert", className: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
  monitoring: { label: "Surveillance", className: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  resolved: { label: "Résolu", className: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
};

const FILTERS: { key: "active" | "all" | EntryStatus; label: string }[] = [
  { key: "active", label: "Actifs" },
  { key: "resolved", label: "Résolus" },
  { key: "all", label: "Tout" },
];

export function ChangelogPanel() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"active" | "all" | EntryStatus>("active");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ type: "watch" as EntryType, title: "", description: "", status: "open" as EntryStatus });

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ entries: ChangelogEntry[] }>("/api/admin/changelog");
      setEntries(data.entries);
    } catch {
      toast.error("Impossible de charger le journal");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addEntry() {
    if (!form.title.trim()) { toast.error("Titre requis"); return; }
    setBusy(true);
    try {
      await api.post("/api/admin/changelog", form);
      toast.success("Entrée ajoutée");
      setForm({ type: "watch", title: "", description: "", status: "open" });
      setShowForm(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(id: number, status: EntryStatus) {
    const prev = entries;
    setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, status } : e)));
    try {
      await api.patch("/api/admin/changelog", { id, status });
    } catch {
      setEntries(prev);
      toast.error("Erreur de mise à jour");
    }
  }

  async function removeEntry(id: number) {
    const prev = entries;
    setEntries((cur) => cur.filter((e) => e.id !== id));
    try {
      await api.delete("/api/admin/changelog", { id });
    } catch {
      setEntries(prev);
      toast.error("Erreur de suppression");
    }
  }

  const openCount = entries.filter((e) => e.status !== "resolved").length;
  const filtered = entries.filter((e) => {
    if (filter === "all") return true;
    if (filter === "active") return e.status !== "resolved";
    return e.status === filter;
  });

  return (
    <CollapsibleBlock
      className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-5 space-y-4"
      header={
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 flex items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]">
            <Bug className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Journal des bugs & améliorations</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loading ? "Chargement…" : openCount > 0 ? `${openCount} point(s) actif(s)` : "Tout est résolu"} — {entries.length} entrées au total
            </p>
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                filter === f.key
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                  : "bg-white/[0.02] border-white/[0.06] text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowForm((v) => !v)}
          className="h-8 text-xs gap-1.5 border-white/10"
        >
          <Plus className="h-3.5 w-3.5" /> Ajouter
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as EntryType }))}
              className="h-9 rounded-md border border-white/10 bg-transparent px-2.5 text-sm text-foreground"
            >
              <option value="watch" className="bg-[#0A0A0A]">À surveiller</option>
              <option value="fix" className="bg-[#0A0A0A]">Bug corrigé</option>
              <option value="improvement" className="bg-[#0A0A0A]">Amélioration</option>
            </select>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as EntryStatus }))}
              className="h-9 rounded-md border border-white/10 bg-transparent px-2.5 text-sm text-foreground"
            >
              <option value="open" className="bg-[#0A0A0A]">Ouvert</option>
              <option value="monitoring" className="bg-[#0A0A0A]">Surveillance</option>
              <option value="resolved" className="bg-[#0A0A0A]">Résolu</option>
            </select>
          </div>
          <Input
            placeholder="Titre"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <Textarea
            placeholder="Description (optionnel)"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="min-h-20 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)} className="h-8 text-xs">
              Annuler
            </Button>
            <Button type="button" size="sm" onClick={addEntry} disabled={busy} className="h-8 text-xs">
              Enregistrer
            </Button>
          </div>
        </div>
      )}

      <div className="max-h-[32rem] overflow-y-auto space-y-2 pr-1">
        {filtered.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground text-center py-6">Aucune entrée pour ce filtre.</p>
        )}
        {filtered.map((entry) => {
          const typeMeta = TYPE_META[entry.type];
          const statusMeta = STATUS_META[entry.status];
          const TypeIcon = typeMeta.icon;
          return (
            <div key={entry.id} className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-3.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className={cn("h-6 w-6 shrink-0 rounded-md border flex items-center justify-center mt-0.5", typeMeta.className)}>
                    <TypeIcon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground leading-snug">{entry.title}</h3>
                    {entry.description && (
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{entry.description}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground/60 mt-1.5">
                      {new Date(entry.createdAt * 1000).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                      {entry.createdBy && ` · ${entry.createdBy}`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  className="shrink-0 text-muted-foreground/50 hover:text-rose-400 transition-colors"
                  aria-label="Supprimer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 pl-8.5">
                {(["open", "monitoring", "resolved"] as EntryStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => updateStatus(entry.id, s)}
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all",
                      entry.status === s ? statusMeta.className : "text-muted-foreground/50 border-white/[0.06] hover:text-foreground",
                    )}
                  >
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleBlock>
  );
}
