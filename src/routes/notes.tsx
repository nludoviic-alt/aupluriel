import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  NotebookPen,
  Plus,
  Trash2,
  Calendar,
  ChevronRight,
  FileText,
  ChevronLeft,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notes")({
  head: () => ({ meta: [{ title: "Notes — Au Pluriel" }] }),
  component: NotesPage,
});

const AUTOSAVE_DELAY_MS = 1500;

interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
}

function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNoteRef = useRef<Note | null>(null);

  // Fetch all notes on mount
  useEffect(() => {
    api.get<{ notes: Note[] }>("/api/notes")
      .then((data) => {
        setNotes(data.notes);
        if (data.notes.length > 0) {
          setActiveNoteId(data.notes[0].id);
        }
      })
      .catch(() => toast.error("Impossible de charger les notes"))
      .finally(() => setLoading(false));
  }, []);

  const activeNote = notes.find((n) => n.id === activeNoteId) || null;
  activeNoteRef.current = activeNote;

  // Flush any pending save immediately when switching active note or leaving
  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (activeNoteRef.current) {
        await save(activeNoteRef.current);
      }
    }
  }, []);

  const save = useCallback(async (noteToSave: Note) => {
    setSaving(true);
    try {
      const res = await api.put<{ updatedAt: number }>("/api/notes", {
        id: noteToSave.id,
        title: noteToSave.title,
        content: noteToSave.content,
      });
      setLastSavedAt(res.updatedAt);
      setNotes((prev) =>
        prev.map((n) => (n.id === noteToSave.id ? { ...n, updatedAt: res.updatedAt } : n))
      );
    } catch {
      toast.error("Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }, []);

  function handleNoteChange(updatedFields: Partial<Note>) {
    if (!activeNoteId) return;

    setNotes((prev) =>
      prev.map((n) => (n.id === activeNoteId ? { ...n, ...updatedFields } : n))
    );

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const currentActive = activeNoteRef.current;
      if (currentActive) {
        save(currentActive);
      }
    }, AUTOSAVE_DELAY_MS);
  }

  // Handle active note switch
  async function handleSelectNote(id: string) {
    await flushSave();
    setActiveNoteId(id);
    setLastSavedAt(null);
  }

  // Create a new note
  async function handleCreateNote() {
    await flushSave();
    setSaving(true);
    try {
      const newNote = await api.post<Note>("/api/notes", {});
      setNotes((prev) => [newNote, ...prev]);
      setActiveNoteId(newNote.id);
      setLastSavedAt(null);
      toast.success("Nouvelle note créée");
    } catch {
      toast.error("Erreur lors de la création de la note");
    } finally {
      setSaving(false);
    }
  }

  // Delete active note
  async function handleDeleteNote(id: string) {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    try {
      await api.delete<{ ok: boolean }>("/api/notes", { id });
      setNotes((prev) => prev.filter((n) => n.id !== id));
      toast.success("Note supprimée");
      const remaining = notes.filter((n) => n.id !== id);
      if (remaining.length > 0) {
        setActiveNoteId(remaining[0].id);
      } else {
        setActiveNoteId(null);
      }
      setLastSavedAt(null);
    } catch {
      toast.error("Erreur lors de la suppression");
    }
  }

  // Clean timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-13.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] md:h-[calc(100vh-9.5rem)] overflow-hidden min-h-0">
      {/* HEADER SECTION - Hidden on mobile if a note is active */}
      <div className={cn("flex items-center justify-between border-b border-white/[0.06] bg-white/[0.01] px-6 py-4 shrink-0", activeNoteId ? "hidden md:flex" : "flex")}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 shadow-inner">
            <NotebookPen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground font-sans">Carnet de Notes</h1>
            <p className="text-xs text-muted-foreground">Prends des notes sur le marché ou tes stratégies</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Saving indicator */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-h-5 select-none">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-400" />
                Enregistrement…
              </>
            ) : lastSavedAt ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                Enregistré à{" "}
                {new Date(lastSavedAt * 1000).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </>
            ) : activeNote ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground/45" />
                Dernière modif :{" "}
                {new Date(activeNote.updatedAt * 1000).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "short",
                })}
              </>
            ) : null}
          </div>

          <button
            onClick={handleCreateNote}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white shadow-md shadow-rose-950/20 transition-all duration-200 cursor-pointer"
          >
            <Plus className="h-4.5 w-4.5" />
            Nouvelle Note
          </button>
        </div>
      </div>

      {/* WORKSPACE AREA */}
      <div className="flex flex-1 min-h-0 divide-x divide-white/[0.06] overflow-hidden">
        {/* LIST COLUMN */}
        <div className={cn("flex flex-col bg-white/[0.01] overflow-y-auto p-3", activeNoteId ? "hidden md:flex md:w-80 shrink-0" : "w-full md:w-80 shrink-0")}>
          {loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-20 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.02]"
                />
              ))}
            </div>
          ) : notes.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground/60 space-y-4 p-6 select-none">
              <FileText className="h-10 w-10 text-muted-foreground/20" />
              <div className="text-sm">Aucune note pour le moment.</div>
              <button
                onClick={handleCreateNote}
                className="text-xs text-rose-400 hover:text-rose-300 font-semibold underline cursor-pointer"
              >
                Créer ma première note
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {notes.map((note) => {
                const isActive = note.id === activeNoteId;
                return (
                  <button
                    key={note.id}
                    onClick={() => handleSelectNote(note.id)}
                    className={cn(
                      "w-full text-left p-3.5 rounded-xl border transition-all duration-200 group relative cursor-pointer",
                      isActive
                        ? "bg-rose-500/[0.08] border-rose-500/25 text-foreground"
                        : "bg-transparent border-transparent text-muted-foreground hover:bg-white/[0.02] hover:text-foreground"
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 inset-y-2 w-1 rounded-r-full bg-rose-400" />
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-bold text-[14px] leading-snug truncate pr-4">
                        {note.title.trim() === "" ? "Sans titre" : note.title}
                      </div>
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 transition-transform duration-200",
                          isActive ? "text-rose-400 translate-x-0.5" : "text-muted-foreground/20 group-hover:text-muted-foreground/40"
                        )}
                      />
                    </div>

                    <div className="text-[12px] text-muted-foreground/60 mt-1.5 line-clamp-2 leading-relaxed">
                      {note.content.trim() === "" ? "Rédige une note..." : note.content}
                    </div>

                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground/40 mt-3.5 select-none">
                      <Calendar className="h-3 w-3" />
                      {new Date(note.updatedAt * 1000).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* EDITOR COLUMN */}
        <div className={cn("flex-1 flex flex-col bg-background/40 overflow-hidden relative", activeNoteId ? "flex" : "hidden md:flex")}>
          {/* Subtle Ambient Background glow blobs matching the rose/violet theme */}
          <div className="pointer-events-none absolute -bottom-32 -right-32 h-72 w-72 rounded-full bg-rose-500/[0.02] blur-[90px]" />
          <div className="pointer-events-none absolute -top-32 -left-32 h-72 w-72 rounded-full bg-violet-500/[0.02] blur-[90px]" />

          {activeNote ? (
            <div className="flex-1 flex flex-col p-6 space-y-4 overflow-y-auto z-10">
              {/* Mobile header with back button */}
              <div className="md:hidden flex items-center gap-2 mb-2">
                <button
                  onClick={() => setActiveNoteId(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground cursor-pointer transition-all duration-200 active:scale-90"
                  title="Retour aux notes"
                >
                  <ChevronLeft className="h-4.5 w-4.5" />
                </button>
                <span className="font-bold text-[14.5px] text-foreground tracking-tight font-sans truncate">
                  {activeNote.title.trim() === "" ? "Sans titre" : activeNote.title}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <input
                  type="text"
                  value={activeNote.title}
                  onChange={(e) => handleNoteChange({ title: e.target.value })}
                  placeholder="Titre de la note"
                  className="flex-1 bg-transparent border-none text-2xl font-bold text-foreground focus:outline-none focus:ring-0 placeholder:text-muted-foreground/35 tracking-tight font-sans"
                />

                <button
                  onClick={() => handleDeleteNote(activeNote.id)}
                  title="Supprimer cette note"
                  className="shrink-0 p-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all duration-200 cursor-pointer shadow-sm"
                >
                  <Trash2 className="h-4.5 w-4.5" />
                </button>
              </div>

              <textarea
                value={activeNote.content}
                onChange={(e) => handleNoteChange({ content: e.target.value })}
                placeholder="Rédige tes pensées, tes analyses de trading, ou tes stratégies..."
                className="flex-1 w-full bg-transparent border-none text-[14px] text-foreground leading-relaxed resize-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground/30 min-h-[40vh] py-2"
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-muted-foreground/40 space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.02] border border-white/[0.05] text-muted-foreground/20">
                <FileText className="h-7 w-7" />
              </div>
              <div className="text-sm font-semibold">Sélectionne une note ou crée-en une nouvelle pour commencer à écrire.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
