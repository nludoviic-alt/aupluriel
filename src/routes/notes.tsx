import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, NotebookPen } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/notes")({
  head: () => ({ meta: [{ title: "Notes — Au Pluriel" }] }),
  component: NotesPage,
});

const AUTOSAVE_DELAY_MS = 1500;

function NotesPage() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    api.get<{ content: string; updatedAt: number | null }>("/api/notes")
      .then((data) => {
        setContent(data.content);
        setUpdatedAt(data.updatedAt);
        loaded.current = true;
      })
      .catch(() => toast.error("Impossible de charger les notes"))
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (text: string) => {
    setSaving(true);
    try {
      const res = await api.put<{ updatedAt: number }>("/api/notes", { content: text });
      setUpdatedAt(res.updatedAt);
    } catch {
      toast.error("Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }, []);

  function onChange(text: string) {
    setContent(text);
    if (!loaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(text), AUTOSAVE_DELAY_MS);
  }

  // Flush a pending autosave immediately when leaving the page.
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <NotebookPen className="h-5 w-5 text-[color:var(--brand-cyan)]" />
          Notes
        </h1>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-h-5">
          {saving ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enregistrement…</>
          ) : updatedAt ? (
            <><CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--bull)]" /> Enregistré {new Date(updatedAt * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Chargement…</div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Tes notes personnelles — idées, observations sur le marché, rappels…"
          className="w-full min-h-[60vh] rounded-2xl border border-border bg-card p-4 text-sm text-foreground leading-relaxed resize-y focus:ring-1 focus:ring-cyan-500/50 outline-none"
        />
      )}
    </div>
  );
}
