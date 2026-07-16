import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  Send,
  Plus,
  Users,
  Loader2,
  UserCheck,
  Hash,
  User,
  Shield,
  UserPlus,
  Settings2,
  Mic,
  Square,
  Trash2,
  Smile,
  X,
  ChevronRight,
  ChevronLeft,
  Bell,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getExistingPushSubscription, isPushSupported, subscribeToPush } from "@/lib/push";

export const Route = createFileRoute("/messenger")({
  head: () => ({ meta: [{ title: "Messagerie — Au Pluriel" }] }),
  component: MessengerPage,
});

interface ChatGroup {
  id: string;
  name: string;
  isDirect: number;
  recipientId: number | null;
  createdBy: number | null;
  createdAt: number;
}

interface ChatMessage {
  id: string;
  groupId: string;
  senderId: number;
  content: string;
  createdAt: number;
  senderUsername: string;
  senderIsAdmin: number;
}

interface VerifiedUser {
  id: number;
  username: string;
  email: string;
  groupId: string;
}

const EMOJIS = ["😀", "😂", "👍", "🔥", "🚀", "📈", "📉", "💡", "💰", "👏", "🙏", "⚠️", "❌", "✅", "❤️"];

// Custom Premium Voice Note Player
function VoicePlayer({ src, isMe }: { src: string; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };

    const onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [src]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch((e) => console.error("Error playing audio", e));
      setIsPlaying(true);
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current || !duration) return;
    const value = parseFloat(e.target.value);
    const newTime = (value / 100) * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    setProgress(value);
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-3 w-full max-w-[280px] sm:max-w-[320px] select-none py-1">
      <button
        type="button"
        onClick={togglePlay}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 active:scale-90 shrink-0 shadow-sm cursor-pointer",
          isMe
            ? "bg-white text-black hover:bg-white/90"
            : "bg-amber-500 text-black hover:bg-amber-600"
        )}
      >
        {isPlaying ? (
          <svg className="h-4.5 w-4.5 fill-current" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg className="h-4.5 w-4.5 fill-current ml-0.5" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <input
          type="range"
          min="0"
          max="100"
          value={progress}
          onChange={handleSliderChange}
          className={cn(
            "w-full h-1 rounded-lg appearance-none cursor-pointer focus:outline-none transition-all",
            isMe 
              ? "bg-white/20 accent-white" 
              : "bg-white/10 accent-amber-500"
          )}
        />
        <div className="flex justify-between text-[9.5px] leading-none opacity-60">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

function MessengerPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !user.is_admin && user.chat_enabled !== 1) {
      toast.error("Vous n'avez pas accès à la messagerie.");
      navigate({ to: "/" });
    }
  }, [user, navigate]);

  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [verifiedUsers, setVerifiedUsers] = useState<VerifiedUser[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingSidebar, setLoadingSidebar] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [inputText, setInputText] = useState("");
  
  // Voice note recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);

  // Emoji picker popover state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Modal for group creation (Admin only)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Modal for membership management (Admin only)
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [currentGroupMembers, setCurrentGroupMembers] = useState<number[]>([]);
  const [savingMembers, setSavingMembers] = useState(false);

  // Web Push states
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPermissionDenied, setPushPermissionDenied] = useState(false);

  useEffect(() => {
    const supported = isPushSupported();
    setPushSupported(supported);
    if (supported) {
      getExistingPushSubscription().then((sub) => {
        setPushEnabled(!!sub);
      }).catch(() => {});
      if (typeof Notification !== "undefined") {
        setPushPermissionDenied(Notification.permission === "denied");
      }
    }
  }, []);

  async function handleEnablePush() {
    try {
      await subscribeToPush();
      setPushEnabled(true);
      setPushPermissionDenied(false);
      toast.success("Notifications activées pour cet appareil !");
    } catch (err: any) {
      toast.error(err.message || "Impossible d'activer les notifications");
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        setPushPermissionDenied(true);
      }
    }
  }

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);
  activeGroupIdRef.current = activeGroupId;

  // Load sidebar data (Groups & Users if admin)
  async function loadSidebarData() {
    setLoadingSidebar(true);
    try {
      const groupsRes = await api.get<{ groups: ChatGroup[] }>("/api/chat/groups");
      setGroups(groupsRes.groups);

      if (!!user?.is_admin) {
        const usersRes = await api.get<{ users: VerifiedUser[] }>("/api/chat/users");
        setVerifiedUsers(usersRes.users);
      }

      if (groupsRes.groups.length > 0 && !activeGroupIdRef.current) {
        const publicGroup = groupsRes.groups.find((g) => g.isDirect === 0);
        if (publicGroup) {
          setActiveGroupId(publicGroup.id);
        } else {
          setActiveGroupId(groupsRes.groups[0].id);
        }
      }
    } catch {
      toast.error("Impossible de charger les données");
    } finally {
      setLoadingSidebar(false);
    }
  }

  useEffect(() => {
    if (user) {
      loadSidebarData();
    }
  }, [user]);

  // Fetch messages when active group changes
  useEffect(() => {
    if (!activeGroupId) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);
    api.get<{ messages: ChatMessage[] }>(`/api/chat/messages?groupId=${activeGroupId}`)
      .then((data) => {
        setMessages(data.messages);
        scrollToBottom();
      })
      .catch(() => toast.error("Impossible de charger les messages"))
      .finally(() => setLoadingMessages(false));
  }, [activeGroupId]);

  // Polling for new messages
  useEffect(() => {
    if (!activeGroupId) return;

    const interval = setInterval(() => {
      api.get<{ messages: ChatMessage[] }>(`/api/chat/messages?groupId=${activeGroupId}`)
        .then((data) => {
          setMessages((prev) => {
            if (data.messages.length !== prev.length) {
              setTimeout(scrollToBottom, 50);
              return data.messages;
            }
            if (
              data.messages.length > 0 &&
              prev.length > 0 &&
              data.messages[data.messages.length - 1].id !== prev[prev.length - 1].id
            ) {
              setTimeout(scrollToBottom, 50);
              return data.messages;
            }
            return prev;
          });
        })
        .catch((err) => console.error("Polling messages error:", err));
    }, 3000);

    return () => clearInterval(interval);
  }, [activeGroupId]);

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  // Handle message send
  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!activeGroupId || inputText.trim() === "" || sending) return;

    const content = inputText.trim();
    setInputText("");
    setSending(true);

    try {
      const newMsg = await api.post<ChatMessage>("/api/chat/messages", {
        groupId: activeGroupId,
        content,
      });
      setMessages((prev) => [...prev, newMsg]);
      setTimeout(scrollToBottom, 50);
    } catch (err: any) {
      toast.error(err.message || "Erreur d'envoi");
    } finally {
      setSending(false);
    }
  }

  // Voice note recording logic
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          setSending(true);
          try {
            const newMsg = await api.post<ChatMessage>("/api/chat/messages", {
              groupId: activeGroupId,
              content: base64Audio,
            });
            setMessages((prev) => [...prev, newMsg]);
            setTimeout(scrollToBottom, 50);
            toast.success("Note vocale envoyée");
          } catch (err: any) {
            toast.error(err.message || "Erreur d'envoi du message vocal");
          } finally {
            setSending(false);
          }
        };

        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      toast.error("Impossible d'accéder au microphone.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }
  }

  function cancelRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = () => {
        const stream = mediaRecorderRef.current?.stream;
        stream?.getTracks().forEach((track) => track.stop());
      };
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      toast.info("Enregistrement annulé");
    }
  }

  function formatDuration(sec: number) {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function handleSelectEmoji(emoji: string) {
    setInputText((prev) => prev + emoji);
    setShowEmojiPicker(false);
  }

  // Delete group or conversation chat (Admin only)
  async function handleDeleteGroup() {
    if (!activeGroupId) return;
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer cette discussion définitivement ? Cette action supprimera tous les messages associés et est irréversible.")) {
      return;
    }

    try {
      await api.delete(`/api/chat/groups?groupId=${activeGroupId}`);
      toast.success("Discussion supprimée avec succès");
      setActiveGroupId(null);
      loadSidebarData();
    } catch (err: any) {
      toast.error(err.message || "Impossible de supprimer la discussion");
    }
  }

  // Handle group creation with members selection
  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (newGroupName.trim() === "" || creatingGroup) return;

    setCreatingGroup(true);
    try {
      const newGroup = await api.post<ChatGroup>("/api/chat/groups", {
        name: newGroupName.trim(),
        userIds: selectedUserIds,
      });
      setGroups((prev) => [...prev, newGroup]);
      setActiveGroupId(newGroup.id);
      setShowCreateModal(false);
      setNewGroupName("");
      setSelectedUserIds([]);
      toast.success(`Groupe "${newGroup.name}" créé avec succès`);
      loadSidebarData();
    } catch (err: any) {
      toast.error(err.message || "Erreur de création de groupe");
    } finally {
      setCreatingGroup(false);
    }
  }

  // Open membership modal for active group chat
  async function handleOpenMembersModal() {
    if (!activeGroupId) return;
    setShowMembersModal(true);
    try {
      const res = await api.get<{ userIds: number[] }>(
        `/api/chat/groups/members?groupId=${activeGroupId}`
      );
      setCurrentGroupMembers(res.userIds);
    } catch {
      toast.error("Erreur lors de la récupération des membres");
    }
  }

  // Save updated group membership list
  async function handleSaveGroupMembers(e: React.FormEvent) {
    e.preventDefault();
    if (!activeGroupId || savingMembers) return;

    setSavingMembers(true);
    try {
      await api.post("/api/chat/groups/members", {
        groupId: activeGroupId,
        userIds: currentGroupMembers,
      });
      toast.success("Membres mis à jour");
      setShowMembersModal(false);
    } catch {
      toast.error("Erreur lors de la mise à jour");
    } finally {
      setSavingMembers(false);
    }
  }

  // Toggle user checkbox selection for group creation
  function toggleUserSelection(userId: number) {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  // Toggle user checkbox selection for group membership edit
  function toggleGroupMember(userId: number) {
    setCurrentGroupMembers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  const publicGroups = groups.filter((g) => g.isDirect === 0);
  const userDmGroup = groups.find((g) => g.isDirect === 1);

  // Determine active group name & type
  let activeGroupName = "";
  let isActiveDirect = false;

  const currentGroup = groups.find((g) => g.id === activeGroupId);
  if (currentGroup) {
    activeGroupName = currentGroup.name;
    isActiveDirect = currentGroup.isDirect === 1;
  } else if (!!user?.is_admin) {
    const matchingUser = verifiedUsers.find((u) => u.groupId === activeGroupId);
    if (matchingUser) {
      activeGroupName = matchingUser.username;
      isActiveDirect = true;
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-13.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] md:h-[calc(100vh-9.5rem)] overflow-hidden min-h-0">
      {/* HEADER SECTION */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.01] px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-inner">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground font-sans">Messagerie</h1>
            <p className="text-xs text-muted-foreground">Discussions de groupe, conversations personnelles et vocaux</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {pushSupported && !pushEnabled && (
            <button
              onClick={handleEnablePush}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all duration-200 cursor-pointer shadow-sm",
                pushPermissionDenied
                  ? "border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10"
                  : "border-amber-500/20 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10"
              )}
              title={pushPermissionDenied ? "Notifications bloquées. Activez-les dans les réglages du navigateur." : "Activer les notifications push sur ce téléphone"}
            >
              <Bell className="h-4 w-4 animate-bounce" />
              <span className="hidden sm:inline">
                {pushPermissionDenied ? "Notifications bloquées" : "M'alerter sur mobile"}
              </span>
            </button>
          )}

          {!!user?.is_admin && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black shadow-md shadow-amber-950/20 transition-all duration-200 cursor-pointer"
            >
              <Plus className="h-4.5 w-4.5" />
              Créer un groupe
            </button>
          )}
        </div>
      </div>

      {/* CHAT WORKSPACE */}
      <div className="flex flex-1 min-h-0 divide-x divide-white/[0.06] overflow-hidden">
        {/* SIDEBAR COL */}
        <div className={cn("flex flex-col bg-white/[0.01] overflow-y-auto space-y-6 p-3", activeGroupId ? "hidden md:flex md:w-80 shrink-0" : "w-full md:w-80 shrink-0")}>
          {loadingSidebar ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-16 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.02]"
                />
              ))}
            </div>
          ) : (
            <>
              {/* PUBLIC GROUPS */}
              <div className="space-y-1">
                <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/45 flex items-center gap-1.5 select-none">
                  <Hash className="h-3 w-3" />
                  Groupes & Salons ({publicGroups.length})
                </div>
                {publicGroups.map((group) => {
                  const isActive = group.id === activeGroupId;
                  return (
                    <button
                      key={group.id}
                      onClick={() => setActiveGroupId(group.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-200 text-left group relative cursor-pointer",
                        isActive
                          ? "bg-amber-500/[0.08] border-amber-500/25 text-foreground"
                          : "bg-transparent border-transparent text-muted-foreground hover:bg-white/[0.02] hover:text-foreground"
                      )}
                    >
                      {isActive && (
                        <span className="absolute left-0 inset-y-2 w-1 rounded-r-full bg-amber-400" />
                      )}
                      <span className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm transition-all duration-200",
                        isActive
                          ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
                          : "bg-white/[0.04] border-white/[0.05] text-muted-foreground group-hover:text-foreground group-hover:border-white/10"
                      )}>
                        <Hash className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-[14px] leading-snug truncate pr-4">
                          {group.name}
                        </div>
                      </div>
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 transition-transform duration-200",
                          isActive ? "text-amber-400 translate-x-0.5" : "text-muted-foreground/20 group-hover:text-muted-foreground/40"
                        )}
                      />
                    </button>
                  );
                })}
              </div>

              {/* PRIVATE MESSAGES */}
              <div className="space-y-1">
                <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/45 flex items-center gap-1.5 select-none">
                  <UserCheck className="h-3 w-3" />
                  Messages Personnels
                </div>

                {!!user?.is_admin ? (
                  // Admin sees list of verified users to chat with
                  verifiedUsers.length === 0 ? (
                    <div className="text-[12px] text-muted-foreground/50 px-3 py-4 italic bg-white/[0.01] border border-white/[0.04] rounded-xl text-center leading-relaxed">
                      Aucun autre utilisateur enregistré.<br />
                      <span className="text-[9.5px] text-amber-500/60 font-semibold block mt-1">Créez un second compte pour tester</span>
                    </div>
                  ) : (
                    verifiedUsers.map((u) => {
                      const isActive = u.groupId === activeGroupId;
                      return (
                        <button
                          key={u.id}
                          onClick={() => setActiveGroupId(u.groupId)}
                          className={cn(
                            "w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-200 text-left group relative cursor-pointer",
                            isActive
                              ? "bg-amber-500/[0.08] border-amber-500/25 text-foreground"
                              : "bg-transparent border-transparent text-muted-foreground hover:bg-white/[0.02] hover:text-foreground"
                          )}
                        >
                          {isActive && (
                            <span className="absolute left-0 inset-y-2 w-1 rounded-r-full bg-amber-400" />
                          )}
                          <span className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm transition-all duration-200",
                            isActive
                              ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
                              : "bg-white/[0.04] border-white/[0.05] text-muted-foreground group-hover:text-foreground group-hover:border-white/10"
                          )}>
                            <User className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-[14px] leading-snug truncate pr-4">
                              {u.username}
                            </div>
                            <div className="text-[10.5px] text-muted-foreground/50 truncate mt-0.5">
                              {u.email}
                            </div>
                          </div>
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 shrink-0 transition-transform duration-200",
                              isActive ? "text-amber-400 translate-x-0.5" : "text-muted-foreground/20 group-hover:text-muted-foreground/40"
                            )}
                          />
                        </button>
                      );
                    })
                  )
                ) : (
                  // Regular user sees only their direct chat with the Admin
                  userDmGroup && (
                    <button
                      onClick={() => setActiveGroupId(userDmGroup.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-200 text-left group relative cursor-pointer",
                        userDmGroup.id === activeGroupId
                          ? "bg-amber-500/[0.08] border-amber-500/25 text-foreground"
                          : "bg-transparent border-transparent text-muted-foreground hover:bg-white/[0.02] hover:text-foreground"
                      )}
                    >
                      {userDmGroup.id === activeGroupId && (
                        <span className="absolute left-0 inset-y-2 w-1 rounded-r-full bg-amber-400" />
                      )}
                      <span className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm transition-all duration-200",
                        userDmGroup.id === activeGroupId
                          ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
                          : "bg-white/[0.04] border-white/[0.05] text-muted-foreground group-hover:text-foreground group-hover:border-white/10"
                      )}>
                        <Shield className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-[14px] leading-snug truncate">
                          Support Admin
                        </div>
                        <div className="text-[10.5px] text-muted-foreground/50 truncate mt-0.5">
                          Conversation privée
                        </div>
                      </div>
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 transition-transform duration-200",
                          userDmGroup.id === activeGroupId ? "text-amber-400 translate-x-0.5" : "text-muted-foreground/20 group-hover:text-muted-foreground/40"
                        )}
                      />
                    </button>
                  )
                )}
              </div>
            </>
          )}
        </div>

        {/* CHAT WINDOW */}
        <div className={cn("flex-1 flex flex-col bg-background/40 overflow-hidden relative min-h-0", activeGroupId ? "flex" : "hidden md:flex")}>
          {/* Subtle Ambient Background glow blobs matching the application style */}
          <div className="pointer-events-none absolute -bottom-32 -right-32 h-72 w-72 rounded-full bg-amber-500/[0.02] blur-[90px]" />
          <div className="pointer-events-none absolute -top-32 -left-32 h-72 w-72 rounded-full bg-violet-500/[0.02] blur-[90px]" />

          {activeGroupId ? (
            <>
              {/* CHAT WINDOW HEADER */}
              <div className="flex items-center justify-between border-b border-white/[0.05] bg-white/[0.01] px-6 py-4 shrink-0 z-10">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveGroupId(null)}
                    className="md:hidden flex items-center justify-center p-2 rounded-xl border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground cursor-pointer mr-1.5 transition-all duration-200"
                    title="Retour aux conversations"
                  >
                    <ChevronLeft className="h-4.5 w-4.5" />
                  </button>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-sm">
                    {isActiveDirect ? <Shield className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                  </span>
                  <span className="font-bold text-[15px] text-foreground tracking-tight font-sans">
                    {isActiveDirect ? `${activeGroupName} (Privé)` : activeGroupName}
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 ml-1.5 animate-pulse" />
                </div>

                <div className="flex items-center gap-2">
                  {!isActiveDirect && !!user?.is_admin && (
                    <button
                      onClick={handleOpenMembersModal}
                      title="Gérer les membres du groupe"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.08] hover:border-white/15 transition-all duration-200 cursor-pointer"
                    >
                      <Settings2 className="h-3.5 w-3.5 text-amber-400" />
                      <span className="hidden sm:inline">Membres</span>
                    </button>
                  )}

                  {!!user?.is_admin && (
                    <button
                      onClick={handleDeleteGroup}
                      title="Supprimer la discussion"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-500/20 bg-red-500/5 hover:bg-red-500/15 hover:border-red-500/30 text-red-400 transition-all duration-200 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Supprimer</span>
                    </button>
                  )}
                </div>
              </div>

              {/* MESSAGES THREAD */}
              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4 z-10">
                {loadingMessages && messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-7 w-7 animate-spin text-amber-400/80" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground/40 space-y-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.02] border border-white/[0.05] text-muted-foreground/30">
                      <MessageSquare className="h-6 w-6" />
                    </div>
                    <div className="text-sm font-semibold">Aucun message dans ce salon.</div>
                    <div className="text-xs text-muted-foreground/60">Soyez le premier à envoyer un message !</div>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMe = msg.senderId === user?.id;
                    const isAdminSender = msg.senderIsAdmin === 1;
                    const isVoiceNote = msg.content.startsWith("data:audio/");

                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex flex-col max-w-[70%] animate-in fade-in-50 duration-200",
                          isMe ? "ml-auto items-end" : "mr-auto items-start"
                        )}
                      >
                        {/* Sender labels */}
                        <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/50 mb-1 px-1 select-none">
                          <span className={cn(isMe ? "text-amber-400 font-bold" : "text-muted-foreground font-semibold")}>
                            {msg.senderUsername}
                          </span>
                          {isAdminSender && (
                            <span className="inline-flex items-center gap-0.5 text-[8.5px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 uppercase tracking-widest leading-none">
                              Admin
                            </span>
                          )}
                        </div>

                        {/* Message bubble */}
                        <div
                          className={cn(
                            "rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed shadow-md",
                            isVoiceNote && "min-w-[280px] sm:min-w-[320px] bg-none shadow-none p-0 border-0!",
                            !isVoiceNote && (
                              isMe
                                ? cn(
                                    "text-white rounded-tr-none bg-gradient-to-br border shadow-md",
                                    isAdminSender
                                      ? "from-amber-500 to-amber-600 border-amber-400/20 shadow-amber-950/20"
                                      : "from-violet-500 to-indigo-600 border-violet-400/20 shadow-violet-950/20"
                                  )
                                : cn(
                                    "text-foreground rounded-tl-none bg-white/[0.03] border border-white/[0.07] backdrop-blur-sm",
                                    isAdminSender && "border-amber-500/20 bg-amber-500/[0.02]"
                                  )
                            )
                          )}
                        >
                          {isVoiceNote ? (
                            <div className={cn(
                              "rounded-2xl p-3 border shadow-md",
                              isMe
                                ? cn(
                                    "bg-gradient-to-br text-white rounded-tr-none",
                                    isAdminSender
                                      ? "from-amber-500 to-amber-600 border-amber-400/20 shadow-amber-950/20"
                                      : "from-violet-500 to-indigo-600 border-violet-400/20 shadow-violet-950/20"
                                  )
                                : cn(
                                    "bg-white/[0.03] border-white/[0.07] text-foreground rounded-tl-none",
                                    isAdminSender && "border-amber-500/20 bg-amber-500/[0.02]"
                                  )
                            )}>
                              <VoicePlayer src={msg.content} isMe={isMe} />
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                          )}
                        </div>

                        {/* Msg timestamp */}
                        <span className="text-[9px] text-muted-foreground/35 mt-1.5 px-1 select-none">
                          {new Date(msg.createdAt * 1000).toLocaleTimeString("fr-FR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* INPUT BAR */}
              <div className="p-4 border-t border-white/[0.06] bg-gradient-to-b from-transparent to-black/30 shrink-0 relative z-10">
                {/* Emoji Picker Popover */}
                {showEmojiPicker && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setShowEmojiPicker(false)}
                    />
                    <div className="absolute bottom-[4.5rem] left-6 z-40 bg-[oklch(0.16_0.03_250)] border border-white/[0.08] rounded-2xl p-2.5 shadow-2xl w-60 grid grid-cols-5 gap-1.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
                      {EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleSelectEmoji(emoji)}
                          className="flex h-9 w-9 items-center justify-center text-[18px] rounded-xl hover:bg-white/[0.06] active:bg-white/[0.1] active:scale-95 transition-all duration-100 cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Input Controls Strip */}
                {isRecording ? (
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-red-500/35 bg-red-500/[0.04] px-4.5 py-3 shadow-[0_0_15px_rgba(239,68,68,0.05)] animate-pulse">
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wider text-red-400 font-sans">Enregistrement vocal</span>
                      <span className="font-mono text-sm font-semibold text-foreground ml-1.5">
                        {formatDuration(recordingDuration)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelRecording}
                        className="px-3.5 py-2 text-xs font-bold rounded-xl border border-white/10 bg-transparent hover:bg-white/5 text-muted-foreground transition-all duration-200 cursor-pointer"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={stopRecording}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-red-500 hover:bg-red-600 text-white shadow-md shadow-red-950/20 transition-all duration-200 cursor-pointer"
                      >
                        <Square className="h-3 w-3 fill-current" />
                        Terminer et Envoyer
                      </button>
                    </div>
                  </div>
                ) : (
                  <form
                    onSubmit={handleSendMessage}
                    className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 focus-within:border-amber-500/40 focus-within:bg-white/[0.05] transition-all duration-200 relative shadow-lg shadow-black/45"
                  >
                    {/* Smiley Button */}
                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      title="Ajouter un emoji"
                      className={cn(
                        "p-2 rounded-xl hover:bg-white/[0.06] text-muted-foreground hover:text-amber-400 transition-all duration-150 shrink-0 cursor-pointer",
                        showEmojiPicker && "text-amber-400 bg-white/[0.04]"
                      )}
                    >
                      <Smile className="h-5 w-5" />
                    </button>

                    <textarea
                      rows={1}
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage(e);
                        }
                      }}
                      placeholder="Écrivez votre message..."
                      className="flex-1 bg-transparent border-none text-[13.5px] text-foreground placeholder:text-muted-foreground/35 focus:outline-none focus:ring-0 resize-none max-h-24 overflow-y-auto leading-relaxed py-1"
                    />

                    {/* Microphone Button */}
                    <button
                      type="button"
                      onClick={startRecording}
                      title="Enregistrer un message vocal"
                      className="p-2 rounded-xl hover:bg-white/[0.06] text-muted-foreground hover:text-amber-400 transition-all duration-150 shrink-0 cursor-pointer"
                    >
                      <Mic className="h-5 w-5" />
                    </button>

                    <button
                      type="submit"
                      disabled={inputText.trim() === "" || sending}
                      className="shrink-0 p-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-30 disabled:hover:bg-amber-500 text-black shadow-md shadow-amber-950/20 transition-all duration-200 cursor-pointer"
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin text-black" />
                      ) : (
                        <Send className="h-4 w-4 text-black fill-current" />
                      )}
                    </button>
                  </form>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-muted-foreground/40 space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.02] border border-white/[0.05] text-muted-foreground/20">
                <MessageSquare className="h-7 w-7" />
              </div>
              <div className="text-sm font-semibold">Sélectionnez un groupe ou un utilisateur pour commencer à échanger.</div>
            </div>
          )}
        </div>
      </div>

      {/* CREATE GROUP MODAL (Admin Only) */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/[0.08] bg-[oklch(0.15_0.03_250)] p-6 shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-inner">
                <Plus className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground font-sans">Créer un groupe</h3>
                <p className="text-xs text-muted-foreground">Sélectionnez les membres à ajouter au salon</p>
              </div>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Nom du groupe</label>
                <input
                  type="text"
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="ex. Signaux & Analyses"
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4.5 py-3 text-sm text-foreground focus:border-amber-500/40 outline-none transition-all duration-150"
                />
              </div>

              {/* Members Selection checkboxes */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Membres à inviter</label>
                <div className="border border-white/[0.08] bg-white/[0.02] rounded-xl max-h-40 overflow-y-auto p-2.5 space-y-1 select-none">
                  {verifiedUsers.length === 0 ? (
                    <div className="text-[12px] text-muted-foreground/50 italic p-2 text-center">
                      Aucun utilisateur disponible pour l'instant
                    </div>
                  ) : (
                    verifiedUsers.map((u) => (
                      <label
                        key={u.id}
                        className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-all duration-150"
                      >
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(u.id)}
                          onChange={() => toggleUserSelection(u.id)}
                          className="rounded border-white/20 bg-transparent text-amber-500 focus:ring-0 focus:ring-offset-0 h-4 w-4 cursor-pointer"
                        />
                        <span className="font-medium text-[13px]">{u.username}</span>
                        <span className="text-[10px] text-muted-foreground/50">({u.email})</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewGroupName("");
                    setSelectedUserIds([]);
                  }}
                  className="px-4 py-2.5 text-xs font-semibold rounded-xl border border-white/10 hover:bg-white/5 text-muted-foreground transition-all duration-200 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={newGroupName.trim() === "" || creatingGroup}
                  className="flex items-center gap-1.5 px-4.5 py-2.5 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black transition-all duration-200 cursor-pointer"
                >
                  {creatingGroup ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-black" />
                      Création…
                    </>
                  ) : (
                    "Créer le groupe"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MANAGE MEMBERS MODAL (Admin Only) */}
      {showMembersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/[0.08] bg-[oklch(0.15_0.03_250)] p-6 shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-inner">
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground font-sans">Membres du groupe</h3>
                <p className="text-xs text-muted-foreground">Ajoutez ou retirez des membres de ce groupe</p>
              </div>
            </div>

            <form onSubmit={handleSaveGroupMembers} className="space-y-4">
              {/* Members checkboxes */}
              <div className="border border-white/[0.08] bg-white/[0.02] rounded-xl max-h-60 overflow-y-auto p-2.5 space-y-1 select-none">
                {verifiedUsers.length === 0 ? (
                  <div className="text-[12px] text-muted-foreground/50 italic p-2 text-center">
                    Aucun utilisateur disponible
                  </div>
                ) : (
                  verifiedUsers.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-all duration-150"
                    >
                      <input
                        type="checkbox"
                        checked={currentGroupMembers.includes(u.id)}
                        onChange={() => toggleGroupMember(u.id)}
                        className="rounded border-white/20 bg-transparent text-amber-500 focus:ring-0 focus:ring-offset-0 h-4 w-4 cursor-pointer"
                      />
                      <span className="font-medium text-[13px]">{u.username}</span>
                      <span className="text-[10px] text-muted-foreground/50">({u.email})</span>
                    </label>
                  ))
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMembersModal(false)}
                  className="px-4 py-2.5 text-xs font-semibold rounded-xl border border-white/10 hover:bg-white/5 text-muted-foreground transition-all duration-200 cursor-pointer"
                >
                  Fermer
                </button>
                <button
                  type="submit"
                  disabled={savingMembers}
                  className="flex items-center gap-1.5 px-4.5 py-2.5 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black transition-all duration-200 cursor-pointer"
                >
                  {savingMembers ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-black" />
                      Enregistrement…
                    </>
                  ) : (
                    "Enregistrer"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
