import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  NotebookPen,
  Plus,
  Trash2,
  Calendar,
  ChevronRight,
  ChevronLeft,
  FileText,
  Search,
  Pin,
  Copy,
  Check,
  Sparkles,
  Bold,
  Italic,
  List,
  ListTodo,
  Code,
  Quote,
  Maximize2,
  Minimize2,
  Clock,
  Type,
  X,
  Hash,
  Eye,
  Edit3,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";

export const Route = createFileRoute("/carnet-de-notes")({
  head: () => ({ meta: [{ title: "Notes — Au Pluriel" }] }),
  component: NotesPage,
});

const AUTOSAVE_DELAY_MS = 1200;

interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
}

// Quick insertion symbols for quants & traders
const TRADING_SYMBOLS = ["$BOOM1000", "$CRASH1000", "$BOOM500", "$CRASH500", "$XAUUSD", "$BTCUSD"];

// Helper to strip markdown symbols for clean snippet previews
function stripMarkdown(text: string) {
  return text
    .replace(/#+\s+/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^-\s+\[[ x]\]\s+/gm, "")
    .replace(/^-\s+/gm, "")
    .replace(/---/g, "")
    .trim();
}

// Rich Markdown Renderer for Preview Mode
function MarkdownRenderer({ content }: { content: string }) {
  if (!content.trim()) {
    return <div className="text-muted-foreground/40 italic py-4">Note vide. Écris du contenu ou bascule en mode édition.</div>;
  }

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inTable = false;
  let tableRows: string[][] = [];
  let tableHeader: string[] = [];

  const parseInline = (text: string) => {
    const parts = text.split(/(\*\*.+?\*\*|\*[^*]+\*|`[^`]+`|\$[A-Z0-9_]+)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
        return <strong key={idx} className="font-bold text-foreground">{parseInline(part.slice(2, -2))}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
        return <em key={idx} className="italic text-foreground/90">{parseInline(part.slice(1, -1))}</em>;
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        return (
          <code key={idx} className="bg-rose-500/10 border border-rose-500/20 text-rose-300 font-mono px-1.5 py-0.5 rounded text-xs">
            {part.slice(1, -1)}
          </code>
        );
      }
      if (/^\$[A-Z0-9_]+$/.test(part)) {
        return (
          <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono mx-0.5">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const flushTable = (key: number) => {
    if (!inTable) return null;
    const tableEl = (
      <div key={key} className="overflow-x-auto my-4 rounded-xl border border-white/[0.08] bg-white/[0.02]">
        <table className="w-full text-xs text-left border-collapse">
          {tableHeader.length > 0 && (
            <thead className="bg-white/[0.04] text-rose-300 font-bold border-b border-white/[0.08]">
              <tr>
                {tableHeader.map((cell, cIdx) => (
                  <th key={cIdx} className="px-3.5 py-2.5">{parseInline(cell.trim())}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-white/[0.04]">
            {tableRows.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-white/[0.02] transition-colors">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="px-3.5 py-2">{parseInline(cell.trim())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    inTable = false;
    tableRows = [];
    tableHeader = [];
    return tableEl;
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed.split("|").slice(1, -1);
      if (cells.every((c) => /^[:\-\s]+$/.test(c))) {
        return;
      }
      if (!inTable) {
        inTable = true;
        tableHeader = cells;
      } else {
        tableRows.push(cells);
      }
      return;
    } else if (inTable) {
      const tbl = flushTable(index * 100);
      if (tbl) elements.push(tbl);
    }

    if (trimmed === "---" || trimmed === "***") {
      elements.push(<hr key={index} className="my-4 border-white/10" />);
      return;
    }

    if (trimmed.startsWith("# ")) {
      elements.push(
        <h1 key={index} className="text-2xl font-black text-foreground tracking-tight mt-6 mb-3 bg-gradient-to-r from-white via-white/90 to-rose-200 bg-clip-text text-transparent">
          {parseInline(trimmed.slice(2))}
        </h1>
      );
      return;
    }

    if (trimmed.startsWith("## ")) {
      elements.push(
        <h2 key={index} className="text-lg font-extrabold text-foreground tracking-tight mt-5 mb-2.5 text-rose-300 border-b border-white/[0.06] pb-1.5">
          {parseInline(trimmed.slice(3))}
        </h2>
      );
      return;
    }

    if (trimmed.startsWith("### ")) {
      elements.push(
        <h3 key={index} className="text-base font-bold text-foreground mt-4 mb-2">
          {parseInline(trimmed.slice(4))}
        </h3>
      );
      return;
    }

    if (trimmed.startsWith("> ")) {
      elements.push(
        <blockquote key={index} className="border-l-4 border-rose-500/60 pl-4 py-2 my-3 italic bg-rose-500/[0.06] rounded-r-xl text-rose-200 text-xs leading-relaxed border border-rose-500/10">
          {parseInline(trimmed.slice(2))}
        </blockquote>
      );
      return;
    }

    if (trimmed.startsWith("- [ ] ") || trimmed.startsWith("- [x] ")) {
      const checked = trimmed.startsWith("- [x] ");
      elements.push(
        <div key={index} className="flex items-center gap-2 text-xs py-1 text-foreground/90">
          <span className={cn("h-4 w-4 rounded flex items-center justify-center border text-[10px]", checked ? "bg-rose-500 border-rose-500 text-white" : "border-white/20 bg-white/5")}>
            {checked && "✓"}
          </span>
          <span className={checked ? "line-through opacity-50" : ""}>{parseInline(trimmed.slice(6))}</span>
        </div>
      );
      return;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      elements.push(
        <li key={index} className="ml-4 list-disc text-xs md:text-sm text-foreground/90 py-0.5 leading-relaxed">
          {parseInline(trimmed.slice(2))}
        </li>
      );
      return;
    }

    if (trimmed === "") {
      elements.push(<div key={index} className="h-2" />);
      return;
    }

    elements.push(
      <p key={index} className="text-xs md:text-sm text-foreground/90 leading-relaxed my-1">
        {parseInline(line)}
      </p>
    );
  });

  if (inTable) {
    const tbl = flushTable(lines.length * 100);
    if (tbl) elements.push(tbl);
  }

  return <div className="space-y-1 font-sans">{elements}</div>;
}

export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedNoteIds, setPinnedNoteIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("aupluriel_pinned_notes");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [focusMode, setFocusMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("preview");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNoteRef = useRef<Note | null>(null);
  const { confirmState, confirm } = useConfirm();

  // Save pinned state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("aupluriel_pinned_notes", JSON.stringify(pinnedNoteIds));
    } catch {
      // ignore storage errors
    }
  }, [pinnedNoteIds]);

  // Fetch all notes on mount
  useEffect(() => {
    api.get<{ notes: Note[] }>("/api/notes")
      .then((data) => {
        setNotes(data.notes);
        if (data.notes.length > 0 && !activeNoteId) {
          setActiveNoteId(data.notes[0].id);
        }
      })
      .catch(() => toast.error("Impossible de charger les notes"))
      .finally(() => setLoading(false));
  }, []);

  const activeNote = notes.find((n) => n.id === activeNoteId) || null;
  activeNoteRef.current = activeNote;

  // Flush pending save immediately when switching active note or leaving
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
      setViewMode("edit");
      setLastSavedAt(null);
      toast.success("Nouvelle note créée");
    } catch {
      toast.error("Erreur lors de la création de la note");
    } finally {
      setSaving(false);
    }
  }

  // Delete note
  async function handleDeleteNote(id: string) {
    const note = notes.find((n) => n.id === id);
    const title = note?.title?.trim() || "Sans titre";

    const ok = await confirm({
      title: "Supprimer cette note ?",
      description: "« " + title + " » sera définitivement supprimée. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    try {
      await api.delete<{ ok: boolean }>("/api/notes", { id });
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setPinnedNoteIds((prev) => prev.filter((pId) => pId !== id));
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

  // Toggle pin
  function togglePin(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setPinnedNoteIds((prev) => {
      const exists = prev.includes(id);
      if (exists) {
        toast.info("Note désépinglée");
        return prev.filter((item) => item !== id);
      } else {
        toast.success("Note épinglée en haut");
        return [id, ...prev];
      }
    });
  }

  // Format insertion in textarea
  function insertFormat(prefix: string, suffix = "") {
    if (viewMode === "preview") setViewMode("edit");
    setTimeout(() => {
      if (!textareaRef.current || !activeNote) return;
      const el = textareaRef.current;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const text = activeNote.content;
      const selectedText = text.substring(start, end);
      const replacement = prefix + (selectedText || "texte") + suffix;

      const newContent = text.substring(0, start) + replacement + text.substring(end);
      handleNoteChange({ content: newContent });

      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + prefix.length, end + prefix.length + (selectedText ? 0 : 5));
      }, 50);
    }, 50);
  }

  // Quick insert trading symbol badge
  function insertSymbol(symbol: string) {
    if (viewMode === "preview") setViewMode("edit");
    setTimeout(() => {
      if (!textareaRef.current || !activeNote) return;
      const el = textareaRef.current;
      const start = el.selectionStart;
      const text = activeNote.content;
      const newContent = text.substring(0, start) + " " + symbol + " " + text.substring(start);
      handleNoteChange({ content: newContent });
      toast.success(symbol + " inséré");
      setTimeout(() => {
        el.focus();
      }, 50);
    }, 50);
  }

  // Copy active note content
  function copyToClipboard() {
    if (!activeNote) return;
    const fullText = activeNote.title + "\n\n" + activeNote.content;
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    toast.success("Note copiée dans le presse-papier");
    setTimeout(() => setCopied(false), 2000);
  }

  // Clean timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Collect all unique hashtags from notes
  const allHashtags = useMemo(() => {
    const tags = new Set<string>();
    notes.forEach((n) => {
      const fullText = n.title + " " + n.content;
      const matches = fullText.match(/#[a-zA-Z0-9_À-ÿ]+/g);
      if (matches) {
        matches.forEach((t) => tags.add(t.toLowerCase()));
      }
    });
    return Array.from(tags);
  }, [notes]);

  // Filter notes by search query and tag selection
  const filteredNotes = useMemo(() => {
    let result = notes;
    if (selectedTag) {
      result = result.filter((n) =>
        (n.title + " " + n.content).toLowerCase().includes(selectedTag.toLowerCase())
      );
    }
    if (searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => {
      const aPinned = pinnedNoteIds.includes(a.id);
      const bPinned = pinnedNoteIds.includes(b.id);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [notes, searchQuery, selectedTag, pinnedNoteIds]);

  // Active note statistics
  const noteStats = useMemo(() => {
    if (!activeNote) return { words: 0, chars: 0, readingTime: 0 };
    const text = activeNote.content.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.length;
    const readingTime = Math.ceil(words / 200);
    return { words, chars, readingTime };
  }, [activeNote]);

  // Relative time helper
  function formatRelativeDate(timestampSec: number) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestampSec;
    if (diff < 60) return "À l'instant";
    if (diff < 3600) return "Il y a " + Math.floor(diff / 60) + " min";
    const timeStr = new Date(timestampSec * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    if (diff < 86400) return "Aujourd'hui à " + timeStr;
    if (diff < 172800) return "Hier à " + timeStr;
    return new Date(timestampSec * 1000).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
    });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-13.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] md:h-[calc(100vh-9.5rem)] overflow-hidden min-h-0 bg-background/50 rounded-2xl border border-white/[0.06] shadow-2xl">
      {/* ── HEADER SECTION ── */}
      <div className={cn(
        "flex items-center justify-between border-b border-white/[0.06] bg-gradient-to-r from-background/90 via-white/[0.02] to-background/90 px-4 py-3 md:px-6 md:py-3.5 shrink-0 backdrop-blur-xl z-20",
        activeNoteId && focusMode ? "hidden md:flex" : "flex"
      )}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="relative flex h-10 w-10 md:h-11 md:w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/20 via-pink-500/10 to-violet-500/20 border border-rose-500/30 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.15)] shrink-0">
            <NotebookPen className="h-5 w-5 md:h-5.5 md:w-5.5" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500 border border-black"></span>
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-black tracking-tight text-foreground font-sans truncate bg-gradient-to-r from-white via-white/90 to-rose-200 bg-clip-text text-transparent">
                Notes
              </h1>
              <span className="hidden sm:inline-flex items-center rounded-full bg-rose-500/10 border border-rose-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-rose-400">
                {notes.length} {notes.length > 1 ? "notes" : "note"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70 truncate hidden sm:block">
              Journal de trading, opportunités & stratégies quantitatives
            </p>
          </div>
        </div>

        {/* Header right status & action */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Saving Status */}
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground select-none px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.06]">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-400" />
                <span className="hidden md:inline text-rose-300">Enregistrement…</span>
              </>
            ) : lastSavedAt ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span className="hidden md:inline text-emerald-400/90">
                  Enregistré à{" "}
                  {new Date(lastSavedAt * 1000).toLocaleTimeString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </>
            ) : activeNote ? (
              <>
                <Clock className="h-3.5 w-3.5 text-muted-foreground/50" />
                <span className="hidden md:inline text-muted-foreground/70">
                  Modifié {formatRelativeDate(activeNote.updatedAt)}
                </span>
              </>
            ) : null}
          </div>

          {/* New note button */}
          <button
            onClick={handleCreateNote}
            className="flex h-10 items-center justify-center gap-2 px-4 text-xs font-bold rounded-xl bg-gradient-to-r from-rose-500 via-pink-600 to-rose-600 hover:from-rose-600 hover:to-pink-700 text-white shadow-lg shadow-rose-950/40 border border-rose-400/30 transition-all duration-200 cursor-pointer shrink-0 active:scale-95 hover:shadow-rose-500/25"
          >
            <Plus className="h-4 w-4" />
            <span className="whitespace-nowrap">Nouvelle Note</span>
          </button>
        </div>
      </div>

      {/* ── WORKSPACE AREA ── */}
      <div className="flex flex-1 min-h-0 divide-x divide-white/[0.06] overflow-hidden relative">
        {/* ── LEFT COLUMN: SEARCH & NOTES LIST ── */}
        <div
          className={cn(
            "flex flex-col bg-white/[0.01] overflow-hidden transition-all duration-300",
            focusMode ? "hidden md:hidden" : "",
            activeNoteId ? "hidden md:flex md:w-80 lg:w-96 shrink-0" : "w-full md:w-80 lg:w-96 shrink-0"
          )}
        >
          {/* Search bar & filters */}
          <div className="p-3 border-b border-white/[0.06] space-y-2.5 bg-background/30 backdrop-blur-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher une note..."
                className="w-full pl-9 pr-8 py-2 text-xs rounded-xl bg-white/[0.04] border border-white/[0.08] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/30 transition-all duration-200"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Tags filter scroll row if hashtags exist */}
            {allHashtags.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                <button
                  onClick={() => setSelectedTag(null)}
                  className={cn(
                    "text-[10.5px] font-semibold px-2.5 py-1 rounded-lg border transition-all cursor-pointer whitespace-nowrap",
                    selectedTag === null
                      ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
                      : "bg-white/[0.03] border-white/[0.06] text-muted-foreground/60 hover:text-foreground"
                  )}
                >
                  Tous
                </button>
                {allHashtags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                    className={cn(
                      "text-[10.5px] font-semibold px-2.5 py-1 rounded-lg border transition-all cursor-pointer whitespace-nowrap flex items-center gap-1",
                      selectedTag === tag
                        ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
                        : "bg-white/[0.03] border-white/[0.06] text-muted-foreground/60 hover:text-foreground"
                    )}
                  >
                    <Hash className="h-3 w-3 opacity-60" />
                    {tag.replace("#", "")}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Notes list scroll area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar">
            {loading ? (
              <div className="flex flex-col gap-3 p-1">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-24 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.02]"
                  />
                ))}
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground/60 space-y-4 p-8 select-none my-auto">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.03] border border-white/[0.08] text-rose-400/40">
                  <FileText className="h-7 w-7" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground/80">
                    {searchQuery ? "Aucune note ne correspond" : "Aucune note créée"}
                  </div>
                  <p className="text-xs text-muted-foreground/60 max-w-[200px]">
                    {searchQuery
                      ? "Essaie avec d'autres mots clés de recherche."
                      : "Commence à consigner tes idées et stratégies de trading."}
                  </p>
                </div>
                {!searchQuery && (
                  <button
                    onClick={handleCreateNote}
                    className="text-xs text-rose-400 hover:text-rose-300 font-bold underline cursor-pointer pt-1"
                  >
                    Créer ma première note
                  </button>
                )}
              </div>
            ) : (
              filteredNotes.map((note, index) => {
                const isActive = note.id === activeNoteId;
                const isPinned = pinnedNoteIds.includes(note.id);
                const titleText = note.title.trim() === "" ? "Sans titre" : note.title;
                const cleanSnippet = stripMarkdown(note.content);
                const previewText = cleanSnippet === "" ? "Note vide..." : cleanSnippet;

                const colors = [
                  { from: "from-rose-500", to: "to-pink-600", border: "border-rose-500/30", text: "text-rose-400" },
                  { from: "from-violet-500", to: "to-purple-600", border: "border-violet-500/30", text: "text-violet-400" },
                  { from: "from-amber-500", to: "to-orange-600", border: "border-amber-500/30", text: "text-amber-400" },
                  { from: "from-emerald-500", to: "to-teal-600", border: "border-emerald-500/30", text: "text-emerald-400" },
                  { from: "from-cyan-500", to: "to-blue-600", border: "border-cyan-500/30", text: "text-cyan-400" },
                ];
                const color = colors[index % colors.length];

                return (
                  <div key={note.id} className="relative group">
                    <button
                      onClick={() => handleSelectNote(note.id)}
                      className={cn(
                        "w-full text-left p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer overflow-hidden relative",
                        isActive
                          ? "bg-gradient-to-br " + color.from + "/15 " + color.to + "/8 " + color.border + " shadow-lg shadow-rose-950/20 text-foreground ring-1 ring-white/10"
                          : "bg-white/[0.02] border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-white/[0.04] hover:border-white/[0.12]"
                      )}
                    >
                      {/* Active Indicator Strip */}
                      {isActive && (
                        <span className={"absolute left-0 inset-y-2 w-1.5 rounded-r-full bg-gradient-to-b " + color.from + " " + color.to + " shadow-md"} />
                      )}

                      <div className="flex items-start justify-between gap-2.5 pr-14">
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-1.5">
                            {isPinned && (
                              <Pin className="h-3 w-3 text-rose-400 shrink-0 fill-rose-400/30" />
                            )}
                            <div className={cn("font-bold text-sm leading-snug truncate", isActive ? "text-foreground" : "text-foreground/90")}>
                              {titleText}
                            </div>
                          </div>
                          <div className="text-[12px] text-muted-foreground/60 line-clamp-2 leading-relaxed font-sans">
                            {previewText}
                          </div>
                        </div>
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 shrink-0 transition-transform duration-200 mt-0.5",
                            isActive ? color.text + " translate-x-0.5" : "text-muted-foreground/20 group-hover:text-muted-foreground/40"
                          )}
                        />
                      </div>

                      {/* Footer meta (date & word count) */}
                      <div className="flex items-center justify-between text-[10.5px] text-muted-foreground/50 mt-3 pt-2 border-t border-white/[0.04] select-none">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>{formatRelativeDate(note.updatedAt)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>
                            {note.content.trim() ? note.content.trim().split(/\s+/).length + " mots" : "0 mot"}
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Quick action buttons (Pin & Delete) */}
                    <div className="absolute right-2 top-2.5 flex items-center gap-1 opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        onClick={(e) => togglePin(note.id, e)}
                        title={isPinned ? "Désépingler" : "Épingler en haut"}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-xl transition-all cursor-pointer active:scale-90",
                          isPinned
                            ? "text-rose-400 bg-rose-500/15 border border-rose-500/30"
                            : "text-muted-foreground/60 hover:text-rose-300 hover:bg-white/10"
                        )}
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNote(note.id);
                        }}
                        title="Supprimer cette note"
                        className="flex h-7 w-7 items-center justify-center rounded-xl text-muted-foreground/60 hover:text-rose-400 hover:bg-rose-500/15 transition-all cursor-pointer active:scale-90"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN: NOTE EDITOR & RENDERER ── */}
        <div
          className={cn(
            "flex-1 flex flex-col bg-background/60 overflow-hidden relative backdrop-blur-md",
            activeNoteId ? "flex" : "hidden md:flex"
          )}
        >
          {/* Subtle Ambient Background glow blobs */}
          <div className="pointer-events-none absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-rose-500/[0.03] blur-[100px]" />
          <div className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-violet-500/[0.03] blur-[100px]" />

          {activeNote ? (
            <div className="flex-1 flex flex-col min-h-0 z-10 overflow-hidden">
              {/* Editor Toolbar Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02] gap-2 flex-wrap">
                {/* Left mobile back button & View Toggle Segment */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveNoteId(null)}
                    className="md:hidden flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-muted-foreground hover:text-foreground cursor-pointer"
                    title="Retour à la liste"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  {/* Mode Switcher: Éditer vs Aperçu */}
                  <div className="flex items-center p-1 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                    <button
                      onClick={() => setViewMode("edit")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                        viewMode === "edit"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>Éditer</span>
                    </button>
                    <button
                      onClick={() => setViewMode("preview")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                        viewMode === "preview"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Aperçu</span>
                    </button>
                  </div>

                  {/* Formatting tools - visible in edit mode */}
                  {viewMode === "edit" && (
                    <div className="hidden sm:flex items-center gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06]">
                      <button
                        onClick={() => insertFormat("**", "**")}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                        title="Gras (**texte**)"
                      >
                        <Bold className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormat("*", "*")}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                        title="Italique (*texte*)"
                      >
                        <Italic className="h-3.5 w-3.5" />
                      </button>
                      <div className="h-4 w-px bg-white/10 mx-0.5" />
                      <button
                        onClick={() => insertFormat("\n### ")}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                        title="Titre (###)"
                      >
                        <Type className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormat("\n- ")}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                        title="Liste à puces (- )"
                      >
                        <List className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormat("\n- [ ] ")}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                        title="Liste de tâches (- [ ])"
                      >
                        <ListTodo className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormat("\n> ")}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                        title="Citation (> )"
                      >
                        <Quote className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormat("`", "`")}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                        title="Code (`code`)"
                      >
                        <Code className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Insertion shortcuts & toolbar right controls */}
                <div className="flex items-center gap-2 ml-auto">
                  {/* Quick symbol tags */}
                  {viewMode === "edit" && (
                    <div className="hidden lg:flex items-center gap-1.5">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground/40 tracking-wider">
                        Insérer :
                      </span>
                      {TRADING_SYMBOLS.slice(0, 4).map((sym) => (
                        <button
                          key={sym}
                          onClick={() => insertSymbol(sym)}
                          className="text-[10.5px] font-semibold px-2 py-0.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20 hover:border-rose-500/40 transition-all cursor-pointer"
                        >
                          {sym}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="h-4 w-px bg-white/10 hidden lg:block" />

                  {/* Copy content button */}
                  <button
                    onClick={copyToClipboard}
                    title="Copier la note"
                    className="p-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.08] transition-all cursor-pointer"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>

                  {/* Focus mode toggle */}
                  <button
                    onClick={() => setFocusMode(!focusMode)}
                    title={focusMode ? "Afficher la liste" : "Mode plein écran"}
                    className={cn(
                      "p-2 rounded-xl border transition-all cursor-pointer hidden md:flex",
                      focusMode
                        ? "bg-rose-500/20 border-rose-500/40 text-rose-300"
                        : "border-white/[0.07] bg-white/[0.03] text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDeleteNote(activeNote.id)}
                    title="Supprimer cette note"
                    className="p-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-muted-foreground hover:text-rose-400 hover:bg-rose-500/15 hover:border-rose-500/30 transition-all cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Title & Body Container */}
              <div className="flex-1 flex flex-col p-6 space-y-4 overflow-y-auto custom-scrollbar">
                {/* Title Input */}
                <input
                  type="text"
                  value={activeNote.title}
                  onChange={(e) => handleNoteChange({ title: e.target.value })}
                  placeholder="Titre de la note..."
                  className="w-full bg-transparent border-none text-2xl md:text-3xl font-extrabold text-foreground focus:outline-none focus:ring-0 placeholder:text-muted-foreground/30 tracking-tight font-sans"
                />

                {/* Divider with subtle gradient */}
                <div className="h-px w-full bg-gradient-to-r from-white/10 via-rose-500/20 to-transparent" />

                {/* Content: Edit vs Preview */}
                {viewMode === "edit" ? (
                  <textarea
                    ref={textareaRef}
                    value={activeNote.content}
                    onChange={(e) => handleNoteChange({ content: e.target.value })}
                    placeholder="Écris tes analyses de marché, tes paramètres de stratégie, ou tes récapitulatifs de session..."
                    className="flex-1 w-full bg-transparent border-none text-[14.5px] text-foreground/90 leading-relaxed resize-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground/30 font-sans custom-scrollbar min-h-[350px]"
                  />
                ) : (
                  <div className="flex-1 w-full py-2">
                    <MarkdownRenderer content={activeNote.content} />
                  </div>
                )}
              </div>

              {/* Editor Footer Bar */}
              <div className="px-6 py-2.5 border-t border-white/[0.06] bg-white/[0.01] flex items-center justify-between text-xs text-muted-foreground/60 select-none">
                <div className="flex items-center gap-4">
                  <span>{noteStats.words} {noteStats.words > 1 ? "mots" : "mot"}</span>
                  <span>{noteStats.chars} caractères</span>
                  {noteStats.readingTime > 0 && (
                    <span className="hidden sm:inline">
                      Lecture ~{noteStats.readingTime} min
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 text-[11px] text-muted-foreground/40">
                  <Sparkles className="h-3 w-3 text-rose-400/60" />
                  <span>Autosave actif</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground/40 space-y-4 select-none">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.02] border border-white/[0.06] text-muted-foreground/30 shadow-inner">
                <FileText className="h-8 w-8" />
              </div>
              <div className="space-y-1">
                <div className="text-base font-bold text-foreground/80">
                  Sélectionne ou crée une note
                </div>
                <p className="text-xs text-muted-foreground/60 max-w-xs">
                  Sélectionne une note dans la liste à gauche ou clique sur « Nouvelle Note » pour commencer à rédiger.
                </p>
              </div>
              <button
                onClick={handleCreateNote}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20 transition-all cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Créer une note
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog state={confirmState} />
    </div>
  );
}
