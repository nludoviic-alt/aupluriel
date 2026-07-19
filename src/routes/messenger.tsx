import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useSidebar } from "@/components/ui/sidebar";
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
  Trash2,
  Smile,
  X,
  ChevronRight,
  ChevronLeft,
  Bell,
  Paperclip,
  Check,
  CheckCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getExistingPushSubscription, isIosNonSafari, isIosNonStandalone, isPushSupported, subscribeToPush } from "@/lib/push";

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

interface MessageReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

interface ChatMessage {
  id: string;
  groupId: string;
  senderId: number;
  content: string;
  createdAt: number;
  readAt: number | null;
  senderUsername: string;
  senderIsAdmin: number;
  reactions: MessageReaction[];
  pending?: boolean; // optimistic send — not yet confirmed by the server
}

interface VerifiedUser {
  id: number;
  username: string;
  email: string;
  groupId: string;
}

// Generate a consistent color for a user based on their username
function getUserColor(username: string): { bg: string; border: string; shadow: string; text: string; bgSubtle: string } {
  // Simple hash function to generate a number from the username
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Use the hash to pick from a predefined palette of nice colors
  const colors = [
    { bg: 'from-rose-500 to-rose-600', border: 'border-rose-400/20', shadow: 'shadow-rose-950/20', text: 'text-rose-400', bgSubtle: 'bg-rose-500/[0.03]' },
    { bg: 'from-orange-500 to-orange-600', border: 'border-orange-400/20', shadow: 'shadow-orange-950/20', text: 'text-orange-400', bgSubtle: 'bg-orange-500/[0.03]' },
    { bg: 'from-amber-500 to-amber-600', border: 'border-amber-400/20', shadow: 'shadow-amber-950/20', text: 'text-amber-400', bgSubtle: 'bg-amber-500/[0.03]' },
    { bg: 'from-yellow-500 to-yellow-600', border: 'border-yellow-400/20', shadow: 'shadow-yellow-950/20', text: 'text-yellow-400', bgSubtle: 'bg-yellow-500/[0.03]' },
    { bg: 'from-lime-500 to-lime-600', border: 'border-lime-400/20', shadow: 'shadow-lime-950/20', text: 'text-lime-400', bgSubtle: 'bg-lime-500/[0.03]' },
    { bg: 'from-green-500 to-green-600', border: 'border-green-400/20', shadow: 'shadow-green-950/20', text: 'text-green-400', bgSubtle: 'bg-green-500/[0.03]' },
    { bg: 'from-emerald-500 to-emerald-600', border: 'border-emerald-400/20', shadow: 'shadow-emerald-950/20', text: 'text-emerald-400', bgSubtle: 'bg-emerald-500/[0.03]' },
    { bg: 'from-teal-500 to-teal-600', border: 'border-teal-400/20', shadow: 'shadow-teal-950/20', text: 'text-teal-400', bgSubtle: 'bg-teal-500/[0.03]' },
    { bg: 'from-cyan-500 to-cyan-600', border: 'border-cyan-400/20', shadow: 'shadow-cyan-950/20', text: 'text-cyan-400', bgSubtle: 'bg-cyan-500/[0.03]' },
    { bg: 'from-sky-500 to-sky-600', border: 'border-sky-400/20', shadow: 'shadow-sky-950/20', text: 'text-sky-400', bgSubtle: 'bg-sky-500/[0.03]' },
    { bg: 'from-blue-500 to-blue-600', border: 'border-blue-400/20', shadow: 'shadow-blue-950/20', text: 'text-blue-400', bgSubtle: 'bg-blue-500/[0.03]' },
    { bg: 'from-indigo-500 to-indigo-600', border: 'border-indigo-400/20', shadow: 'shadow-indigo-950/20', text: 'text-indigo-400', bgSubtle: 'bg-indigo-500/[0.03]' },
    { bg: 'from-violet-500 to-violet-600', border: 'border-violet-400/20', shadow: 'shadow-violet-950/20', text: 'text-violet-400', bgSubtle: 'bg-violet-500/[0.03]' },
    { bg: 'from-purple-500 to-purple-600', border: 'border-purple-400/20', shadow: 'shadow-purple-950/20', text: 'text-purple-400', bgSubtle: 'bg-purple-500/[0.03]' },
    { bg: 'from-fuchsia-500 to-fuchsia-600', border: 'border-fuchsia-400/20', shadow: 'shadow-fuchsia-950/20', text: 'text-fuchsia-400', bgSubtle: 'bg-fuchsia-500/[0.03]' },
    { bg: 'from-pink-500 to-pink-600', border: 'border-pink-400/20', shadow: 'shadow-pink-950/20', text: 'text-pink-400', bgSubtle: 'bg-pink-500/[0.03]' },
  ];
  
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const EMOJI_CATEGORIES = [
  {
    name: "Smileys",
    icon: "😊",
    emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤔", "🫣", "🤭", "🫢", "🫡", "🤫", "🫠", "🤥", "😶", "🫥", "😐", "😑", "😬", "🫨", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "😵‍💫", "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "💀", "👻", "👽", "👾", "🤖", "💩", "🤡"]
  },
  {
    name: "Gestes & Corps",
    icon: "👍",
    emojis: ["👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦾", "👂", "🦻", "👃", "🧠", "🫀", "🫁", "🦷", "🦴", "👀", "👁️", "👅", "👄", "💋", "🩸"]
  },
  {
    name: "Nature & Animaux",
    icon: "🐱",
    emojis: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻 White", "🐨", "🐯", "🦁", "🐮", "🐷", "🐽", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜", "🕷️", "🕸️", "🦂", "🐢", "🐍", "🦎", "🐙", "🦑", "🦞", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍", "🦧", "🐘", "🦛", "🦏", "🐪", "🐫", "🦒", "🦘", "🐃", "🐂", "🐄", "🐎", "🐖", "🐏", "🐑", "🐐", "🦌", "🐕", "🐈", "🐈‍⬛", "🐓", "🦃", "🦚", "Parrot", "🦜", "🦢", "🦩", "🐾", "🌲", "🌳", "🌴", "🪵", "🌵", "🌾", "🌿", "🍀", "🍁", "🍂", "🍃", "🍄", "🌹", "🌸", "🌺", "🌻", "🌼", "🌷", "🌱", "🪴", "🌙", "☀️", "🌤️", "☁️", "🌧️", "🌩️", "❄️", "🔥", "💧", "🌊"]
  },
  {
    name: "Aliments & Boissons",
    icon: "🍏",
    emojis: ["🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️", "🫑", "🌽", "🥕", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🥞", "🧇", "🥩", "🍗", "🍔", "🍟", "🍕", "🌭", "🥪", "🌮", "🌯", "🥗", "🍿", "🧈", "Salt", "🧂", "🍱", "🍜", "🍝", "🍣", "🍦", "🍧", "Donut", "🍩", "Cookie", "🍪", "🎂", "🧁", "🍫", "🍬", "🍯", "🥛", "☕", "🫖", "🍷", "🍸", "🍺", "🍻", "🥂", "🥃", "🧋"]
  },
  {
    name: "Sports & Loisirs",
    icon: "⚽",
    emojis: ["⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🏓", "🏸", "🏒", "⛳", "🪁", "🏹", "🎣", "🥊", "🥋", "🏃", "🚶", "🏆", "🥇", "🥈", "🥉", "🎟️", "🎨", "🎤", "🎧", "🎼", "🎹", "🥁", "🎸", "🎻", "🎮", "🎳"]
  },
  {
    name: "Voyages & Lieux",
    icon: "🚗",
    emojis: ["🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐", "🛻", "🚚", "🚜", "🛴", "🚲", "🏍️", "🚨", "✈️", "🛫", "🛬", "🪂", "🚀", "🛸", "🚁", "⛵", "🚤", "⚓", "🚧", "⛽", "🎡", "🎢", "🏠", "🏢", "🏥", "🏦", "🏨", "🏫", "🏰", "⛪", "🕌", "⛰️", "🌋", "🏜️", "⛺", "🌌", "🌉"]
  },
  {
    name: "Objets & Outils",
    icon: "💡",
    emojis: ["⌚", "📱", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "📷", "📸", "📹", "🎥", "📞", "☎️", "TV", "📺", "Radio", "📻", "⌛", "💡", "Flashlight", "🔦", "Candle", "🕯️", "🧯", "💰", "💵", "💶", "💳", "💎", "⚖️", "🛠️", "Hammer", "🔨", "Wrench", "🔧", "🪛", "🔑", "Gun", "🔫", "Shield", "🛡️", "Bomb", "💣", "⚰️", "🔮", "Book", "📖", "Envelope", "✉️", "Pen", "✏️", "📎"]
  },
  {
    name: "Symboles & Drapeaux",
    icon: "❤️",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❤️‍🔥", "❤️‍🩹", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "☮️", "✝️", "☪️", "🕉️", "☸️", "✡️", "☯️", "☦️", "🛐", "♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓", "☢️", "☣️", "⬆️", "↗️", "➡️", "↘️", "⬇️", "↙️", "⬅️", "↖️", "↔️", "🔄", "🎵", "🎶", "➕", "➖", "➗", "✖️", "♾️", "💲", "©️", "®️", "🇫🇷", "🇺🇸", "🇬🇧", "🇩🇪", "🇯🇵", "🇨🇳", "🇨🇦", "🇧🇷"]
  }
];

const AVATAR_GRADIENTS = [
  "from-amber-500/25 to-orange-600/25 text-amber-300 border-amber-500/25",
  "from-violet-500/25 to-indigo-600/25 text-violet-300 border-violet-500/25",
  "from-cyan-500/25 to-blue-600/25 text-cyan-300 border-cyan-500/25",
  "from-emerald-500/25 to-teal-600/25 text-emerald-300 border-emerald-500/25",
  "from-pink-500/25 to-rose-600/25 text-pink-300 border-pink-500/25",
  "from-fuchsia-500/25 to-purple-600/25 text-fuchsia-300 border-fuchsia-500/25",
];

function getAvatarStyle(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

function getInitial(name: string) {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

// Locally predicts the post-toggle reaction list so the tap feels instant —
// one reaction per user (picking a new emoji replaces the old one), the
// server response (fetched right after) is the source of truth that follows.
function applyOptimisticReaction(reactions: MessageReaction[], emoji: string): MessageReaction[] {
  const previousMine = reactions.find((r) => r.mine);
  let next = reactions
    .map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r))
    .filter((r) => r.count > 0);

  if (previousMine?.emoji === emoji) return next; // tapping the same emoji again toggles it off

  const existing = next.find((r) => r.emoji === emoji);
  next = existing
    ? next.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r))
    : [...next, { emoji, count: 1, mine: true }];
  return next;
}

function MessengerPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();

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
  const [typingUserIds, setTypingUserIds] = useState<number[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<number>>(new Set());
  const lastTypingSentRef = useRef<number>(0);
  const [loadingSidebar, setLoadingSidebar] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [inputText, setInputText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow the composer textarea like WhatsApp, capped at ~5 lines
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [inputText]);

  // Emoji picker popover state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState(0);

  // Per-message quick-reaction picker (WhatsApp-style: id of the message
  // whose emoji strip is currently open, null when none is)
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);

  // Image upload states & ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

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
  const [pushIosNonSafari, setPushIosNonSafari] = useState(false);
  const [pushIosNonStandalone, setPushIosNonStandalone] = useState(false);

  useEffect(() => {
    const supported = isPushSupported();
    setPushSupported(supported);
    setPushIosNonSafari(isIosNonSafari());
    setPushIosNonStandalone(isIosNonStandalone());
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
        
        // Mark messages as read (only messages not sent by current user)
        const unreadMessages = data.messages.filter(msg => msg.senderId !== user?.id && !msg.readAt);
        unreadMessages.forEach(msg => {
          api.put("/api/chat/messages", { groupId: activeGroupId, messageId: msg.id })
            .catch(() => {}); // Silently fail
        });
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
            const hasNewMessage =
              data.messages.length !== prev.length ||
              (data.messages.length > 0 &&
                prev.length > 0 &&
                data.messages[data.messages.length - 1].id !== prev[prev.length - 1].id);

            if (hasNewMessage) {
              setTimeout(scrollToBottom, 50);
            }

            // Always refresh so readAt (blue checkmarks) updates are reflected
            return data.messages;
          });

          // Mark newly received messages as read
          const unread = data.messages.filter(
            (msg) => msg.senderId !== user?.id && !msg.readAt
          );
          unread.forEach((msg) => {
            api.put("/api/chat/messages", { groupId: activeGroupId, messageId: msg.id })
              .catch(() => {});
          });
        })
        .catch((err) => console.error("Polling messages error:", err));
    }, 3000);

    return () => clearInterval(interval);
  }, [activeGroupId]);

  // Polling for "is typing" status of the other participant(s)
  useEffect(() => {
    setTypingUserIds([]);
    if (!activeGroupId) return;

    const poll = () => {
      api.get<{ typingUserIds: number[] }>(`/api/chat/typing?groupId=${activeGroupId}`)
        .then((data) => setTypingUserIds(data.typingUserIds))
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 2000);

    return () => clearInterval(interval);
  }, [activeGroupId]);

  // Polling for online status of the users listed in the sidebar (admin only —
  // regular users only ever see the admin's presence, which isn't wired up
  // here since their own DM row doesn't carry the admin's user id).
  useEffect(() => {
    if (!user?.is_admin || verifiedUsers.length === 0) {
      setOnlineUserIds(new Set());
      return;
    }
    const ids = verifiedUsers.map((u) => u.id);
    let cancelled = false;
    const poll = () => {
      api.get<{ onlineUserIds: number[] }>(`/api/presence?userIds=${ids.join(",")}`)
        .then((data) => { if (!cancelled) setOnlineUserIds(new Set(data.onlineUserIds)); })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.is_admin, verifiedUsers]);

  // Throttled ping so the other side sees us typing without spamming the endpoint
  function notifyTyping() {
    if (!activeGroupId) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    api.post("/api/chat/typing", { groupId: activeGroupId }).catch(() => {});
  }

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  // Handle message send
  // Sends one piece of content optimistically: it appears in the thread
  // immediately (dimmed, single check) and swaps in for the server's real
  // row the moment the request resolves — no waiting for the next poll.
  async function sendOptimistic(groupId: string, content: string) {
    if (!user) return;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMessage = {
      id: tempId,
      groupId,
      senderId: user.id,
      content,
      createdAt: Math.floor(Date.now() / 1000),
      readAt: null,
      senderUsername: user.username,
      senderIsAdmin: user.is_admin ?? 0,
      reactions: [],
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setTimeout(scrollToBottom, 50);
    try {
      const newMsg = await api.post<ChatMessage>("/api/chat/messages", { groupId, content });
      setMessages((prev) => prev.map((m) => (m.id === tempId ? newMsg : m)));
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      throw err;
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!activeGroupId || sending) return;
    if (inputText.trim() === "" && !selectedImage) return;

    setSending(true);

    try {
      if (selectedImage) {
        const image = selectedImage;
        setSelectedImage(null);
        await sendOptimistic(activeGroupId, image);
      }

      if (inputText.trim() !== "") {
        const content = inputText.trim();
        setInputText("");
        await sendOptimistic(activeGroupId, content);
      }
    } catch (err: any) {
      toast.error(err.message || "Erreur d'envoi");
    } finally {
      setSending(false);
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    setReactionPickerFor(null);
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, reactions: applyOptimisticReaction(m.reactions, emoji) } : m))
    );
    try {
      const res = await api.post<{ reactions: MessageReaction[] }>("/api/chat/reactions", { messageId, emoji });
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: res.reactions } : m)));
    } catch {
      toast.error("Impossible d'ajouter la réaction");
    }
  }

  function handleSelectEmoji(emoji: string) {
    setInputText((prev) => prev + emoji);
    setShowEmojiPicker(false);
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Veuillez sélectionner un fichier image.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.7);
          setSelectedImage(compressedDataUrl);
        }
      };
    };
    reader.readAsDataURL(file);
  };

  // Delete group or conversation chat totally (admin: any conversation; regular user: their own DM only)
  // Callable either from the open chat header (no arg, targets activeGroupId) or
  // directly from a sidebar row (WhatsApp-style, no need to open the conversation first).
  async function handleDeleteGroup(groupIdToDelete?: string) {
    const targetId = groupIdToDelete ?? activeGroupId;
    if (!targetId) return;
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer cette discussion définitivement ? Cette action supprimera tous les messages associés et est irréversible.")) {
      return;
    }

    try {
      await api.delete(`/api/chat/groups?groupId=${targetId}`);
      toast.success("Discussion supprimée avec succès");
      if (targetId === activeGroupId) setActiveGroupId(null);
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
  // Only known when an admin is viewing a specific user's DM — regular users'
  // own DM row doesn't carry the admin's id, so their header just omits the dot.
  let activePartnerId: number | undefined;

  const currentGroup = groups.find((g) => g.id === activeGroupId);
  if (currentGroup) {
    activeGroupName = currentGroup.name;
    isActiveDirect = currentGroup.isDirect === 1;
    if (isActiveDirect && !!user?.is_admin) {
      activePartnerId = currentGroup.recipientId ?? undefined;
    }
  } else if (!!user?.is_admin) {
    const matchingUser = verifiedUsers.find((u) => u.groupId === activeGroupId);
    if (matchingUser) {
      activeGroupName = matchingUser.username;
      isActiveDirect = true;
      activePartnerId = matchingUser.id;
    }
  }
  if (!activeGroupName && activeGroupId) {
    // Sidebar data not loaded yet, or the group/user vanished — never leave the header blank.
    activeGroupName = "Discussion";
  }

  const typingUsernames = typingUserIds
    .map((id) => messages.find((m) => m.senderId === id)?.senderUsername)
    .filter((name): name is string => !!name);
  const typingLabel = isActiveDirect
    ? "en train d'écrire…"
    : typingUsernames.length > 0
      ? `${typingUsernames.join(", ")} ${typingUsernames.length > 1 ? "écrivent" : "écrit"}…`
      : "quelqu'un écrit…";

  return (
    <div className="flex flex-col h-full overflow-hidden min-h-0 bg-background">
      {/* Desktop-only: caps the workspace width and centers it so the sidebar
          and message bubbles don't stretch edge-to-edge on wide monitors. */}
      <div className="flex flex-col flex-1 min-h-0 w-full md:max-w-[1400px] md:mx-auto">
      {/* HEADER SECTION - Hidden on mobile if a discussion is active to save height */}
      <div className={cn("items-center justify-between border-b border-white/[0.06] bg-white/[0.01] px-4 py-3 md:px-6 md:py-4 shrink-0", activeGroupId ? "hidden md:flex" : "flex")}>
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-inner shrink-0">
            <MessageSquare className="h-4.5 w-4.5 md:h-5 md:w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-foreground font-sans truncate">Mes Messages</h1>
            <p className="text-xs text-muted-foreground truncate hidden sm:block">Discussions de groupe, conversations personnelles et vocaux</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!pushEnabled && pushIosNonSafari && (
            <div
              title="Sur iPhone, Chrome ne peut pas activer les notifications — c'est une restriction d'Apple. Ouvre aupluriel.com dans Safari, puis Partager → « Sur l'écran d'accueil »."
              className="flex h-10 items-center justify-center gap-1.5 px-2.5 md:px-3.5 text-xs font-semibold rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 shadow-sm cursor-help"
            >
              <Bell className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline whitespace-nowrap">Ouvrir dans Safari</span>
            </div>
          )}

          {!pushEnabled && !pushIosNonSafari && pushSupported && pushIosNonStandalone && (
            <div
              title="Sur iPhone, ajoute Au Pluriel à l'écran d'accueil (Partager → « Sur l'écran d'accueil ») pour activer les notifications — un onglet Safari classique ne peut pas les recevoir téléphone verrouillé."
              className="flex h-10 items-center justify-center gap-1.5 px-2.5 md:px-3.5 text-xs font-semibold rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-400 shadow-sm cursor-help"
            >
              <Bell className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline whitespace-nowrap">Ajouter à l'accueil</span>
            </div>
          )}

          {pushSupported && !pushEnabled && !pushIosNonSafari && !pushIosNonStandalone && (
            <button
              onClick={handleEnablePush}
              className={cn(
                "flex h-10 items-center justify-center gap-1.5 px-2.5 md:px-3.5 text-xs font-semibold rounded-xl border transition-all duration-200 cursor-pointer shadow-sm active:scale-95",
                pushPermissionDenied
                  ? "border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10"
                  : "border-amber-500/20 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10"
              )}
              title={pushPermissionDenied ? "Notifications bloquées. Activez-les dans les réglages du navigateur." : "Activer les notifications push sur ce téléphone"}
            >
              <Bell className="h-4 w-4 animate-bounce shrink-0" />
              <span className="hidden md:inline whitespace-nowrap">
                {pushPermissionDenied ? "Notifications bloquées" : "M'alerter"}
              </span>
            </button>
          )}

          {!!user?.is_admin && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex h-10 items-center justify-center gap-1.5 px-2.5 md:px-3.5 text-xs font-bold rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black shadow-md shadow-amber-950/20 transition-all duration-200 cursor-pointer shrink-0 active:scale-95"
              title="Créer un groupe"
            >
              <Plus className="h-4.5 w-4.5 shrink-0" />
              <span className="hidden md:inline whitespace-nowrap">Créer un groupe</span>
            </button>
          )}
        </div>
      </div>

      {/* CHAT WORKSPACE */}
      <div className="flex flex-1 min-h-0 divide-x divide-white/[0.06] overflow-hidden">
        {/* SIDEBAR COL */}
        <div className={cn("flex flex-col bg-white/[0.01] overflow-y-auto overscroll-contain space-y-5 p-2.5 sm:p-3", activeGroupId ? "hidden md:flex md:w-80 shrink-0" : "w-full md:w-80 shrink-0")}>
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
                <div className="px-2.5 sm:px-3 mb-2 flex items-center gap-2 select-none">
                  <div className="flex h-6 w-6 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-950/30">
                    <Hash className="h-3 w-3 sm:h-4 sm:w-4 text-white" />
                  </div>
                  <div>
                    <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-violet-300">Groupes & Salons</div>
                    <div className="text-[8.5px] sm:text-[9.5px] text-muted-foreground/60">{publicGroups.length} {publicGroups.length === 1 ? 'groupe' : 'groupes'}</div>
                  </div>
                </div>
                {publicGroups.map((group) => {
                  const isActive = group.id === activeGroupId;
                  return (
                    <div key={group.id} className="relative group">
                      <button
                        onClick={() => setActiveGroupId(group.id)}
                        className={cn(
                          "w-full flex items-center gap-3 p-3 sm:p-3.5 rounded-xl border transition-all duration-150 text-left relative cursor-pointer active:scale-[0.98]",
                          !!user?.is_admin && "pr-11",
                          isActive
                            ? "bg-amber-500/[0.08] border-amber-500/25 text-foreground"
                            : "bg-transparent border-transparent text-muted-foreground hover:bg-white/[0.02] hover:text-foreground"
                        )}
                      >
                        {isActive && (
                          <span className="absolute left-0 inset-y-2 w-1 rounded-r-full bg-amber-400" />
                        )}
                        <span className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm transition-all duration-150",
                          isActive
                            ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
                            : "bg-white/[0.04] border-white/[0.05] text-muted-foreground group-hover:text-foreground group-hover:border-white/10"
                        )}>
                          <Hash className="h-4.5 w-4.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-[14px] leading-snug truncate">
                            {group.name}
                          </div>
                          <div className="text-[10.5px] text-muted-foreground/45 truncate mt-0.5">
                            Salon de groupe
                          </div>
                        </div>
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 shrink-0 transition-transform duration-200",
                            isActive ? "text-amber-400 translate-x-0.5" : "text-muted-foreground/20 group-hover:text-muted-foreground/40"
                          )}
                        />
                      </button>
                      {!!user?.is_admin && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteGroup(group.id);
                          }}
                          title="Supprimer ce salon"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 cursor-pointer active:scale-90"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* PRIVATE MESSAGES */}
              <div className="space-y-1">
                <div className="px-2.5 sm:px-3 mb-2 flex items-center gap-2 select-none">
                  <div className="flex h-6 w-6 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-950/30">
                    <UserCheck className="h-3 w-3 sm:h-4 sm:w-4 text-white" />
                  </div>
                  <div>
                    <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-amber-300">Messages Personnels</div>
                    <div className="text-[8.5px] sm:text-[9.5px] text-muted-foreground/60">{verifiedUsers.length} {verifiedUsers.length === 1 ? 'utilisateur' : 'utilisateurs'}</div>
                  </div>
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
                        <div key={u.id} className="relative group">
                          <button
                            type="button"
                            onClick={() => setActiveGroupId(u.groupId)}
                            className={cn(
                              "w-full flex items-center gap-3 p-3 sm:p-3.5 pr-11 rounded-xl border transition-all duration-150 text-left relative cursor-pointer active:scale-[0.98]",
                              isActive
                                ? "bg-amber-500/[0.08] border-amber-500/25 text-foreground"
                                : "bg-transparent border-transparent text-muted-foreground hover:bg-white/[0.02] hover:text-foreground"
                            )}
                          >
                            {isActive && (
                              <span className="absolute left-0 inset-y-2 w-1 rounded-r-full bg-amber-400" />
                            )}
                            <span className={cn(
                              "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-gradient-to-br text-sm font-bold transition-all duration-150",
                              getAvatarStyle(u.username)
                            )}>
                              {getInitial(u.username)}
                              {onlineUserIds.has(u.id) && (
                                <span
                                  title="En ligne"
                                  className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-background"
                                />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-[14px] leading-snug truncate">
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
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteGroup(u.groupId);
                            }}
                            title="Supprimer cette discussion"
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 cursor-pointer active:scale-90"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })
                  )
                ) : (
                  // Regular user sees only their direct chat with the Admin
                  userDmGroup && (
                    <div className="relative group">
                      <button
                        type="button"
                        onClick={() => setActiveGroupId(userDmGroup.id)}
                        className={cn(
                          "w-full flex items-center gap-3 p-3 sm:p-3.5 pr-11 rounded-xl border transition-all duration-150 text-left relative cursor-pointer active:scale-[0.98]",
                          userDmGroup.id === activeGroupId
                            ? "bg-amber-500/[0.08] border-amber-500/25 text-foreground"
                            : "bg-transparent border-transparent text-muted-foreground hover:bg-white/[0.02] hover:text-foreground"
                        )}
                      >
                        {userDmGroup.id === activeGroupId && (
                          <span className="absolute left-0 inset-y-2 w-1 rounded-r-full bg-amber-400" />
                        )}
                        <span className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm transition-all duration-150",
                          userDmGroup.id === activeGroupId
                            ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
                            : "bg-white/[0.04] border-white/[0.05] text-muted-foreground group-hover:text-foreground group-hover:border-white/10"
                        )}>
                          <Shield className="h-4.5 w-4.5" />
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
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteGroup(userDmGroup.id);
                        }}
                        title="Supprimer cette discussion"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 cursor-pointer active:scale-90"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
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
              <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/60 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-4 shrink-0 z-20 sticky top-0 sm:pt-4">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <button
                    onClick={() => setActiveGroupId(null)}
                    className="md:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground cursor-pointer mr-0.5 transition-all duration-200 active:scale-90"
                    title="Retour aux conversations"
                  >
                    <ChevronLeft className="h-4.5 w-4.5" />
                  </button>
                  <span className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold shadow-sm",
                    isActiveDirect
                      ? cn("bg-gradient-to-br", getAvatarStyle(activeGroupName))
                      : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                  )}>
                    {isActiveDirect ? getInitial(activeGroupName) : <Hash className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1 flex flex-col justify-center">
                    <span className="flex items-center gap-1.5">
                      <span className="font-bold text-[14.5px] sm:text-[15px] text-foreground tracking-tight font-sans truncate">
                        {isActiveDirect ? `${activeGroupName} (Privé)` : activeGroupName}
                      </span>
                      {activePartnerId !== undefined && (
                        <span
                          title={onlineUserIds.has(activePartnerId) ? "En ligne" : "Hors ligne"}
                          className={cn(
                            "h-1.5 w-1.5 rounded-full shrink-0",
                            onlineUserIds.has(activePartnerId) ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30"
                          )}
                        />
                      )}
                    </span>
                    {typingUserIds.length > 0 && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400">
                        <span className="flex items-center gap-0.5">
                          <span className="h-1 w-1 rounded-full bg-amber-400 animate-bounce [animation-delay:-0.3s]" />
                          <span className="h-1 w-1 rounded-full bg-amber-400 animate-bounce [animation-delay:-0.15s]" />
                          <span className="h-1 w-1 rounded-full bg-amber-400 animate-bounce" />
                        </span>
                        {typingLabel}
                      </span>
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {!pushEnabled && pushIosNonSafari && (
                    <div
                      title="Sur iPhone, Chrome ne peut pas activer les notifications — c'est une restriction d'Apple. Ouvre aupluriel.com dans Safari, puis Partager → « Sur l'écran d'accueil »."
                      className="md:hidden flex h-9 items-center gap-1.5 px-2.5 text-xs font-semibold rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 cursor-help"
                    >
                      <Bell className="h-3.5 w-3.5" />
                    </div>
                  )}

                  {!pushEnabled && !pushIosNonSafari && pushSupported && pushIosNonStandalone && (
                    <div
                      title="Sur iPhone, ajoute Au Pluriel à l'écran d'accueil (Partager → « Sur l'écran d'accueil ») pour activer les notifications."
                      className="md:hidden flex h-9 items-center gap-1.5 px-2.5 text-xs font-semibold rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-400 cursor-help"
                    >
                      <Bell className="h-3.5 w-3.5" />
                    </div>
                  )}

                  {pushSupported && !pushEnabled && !pushIosNonSafari && !pushIosNonStandalone && (
                    <button
                      onClick={handleEnablePush}
                      title={pushPermissionDenied ? "Notifications bloquées. Activez-les dans les réglages du navigateur." : "Activer les notifications push sur ce téléphone"}
                      className={cn(
                        "md:hidden flex h-9 items-center gap-1.5 px-2.5 text-xs font-semibold rounded-lg border transition-all duration-200 cursor-pointer active:scale-95",
                        pushPermissionDenied
                          ? "border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10"
                          : "border-amber-500/20 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10"
                      )}
                    >
                      <Bell className="h-3.5 w-3.5 animate-bounce" />
                    </button>
                  )}

                  {!isActiveDirect && !!user?.is_admin && (
                    <button
                      onClick={handleOpenMembersModal}
                      title="Gérer les membres du groupe"
                      className="flex h-9 items-center gap-1.5 px-2.5 sm:px-3 text-xs font-semibold rounded-lg border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.08] hover:border-white/15 transition-all duration-200 cursor-pointer active:scale-95"
                    >
                      <Settings2 className="h-3.5 w-3.5 text-amber-400" />
                      <span className="hidden sm:inline whitespace-nowrap">Membres</span>
                    </button>
                  )}

                  {(!!user?.is_admin || isActiveDirect) && (
                    <button
                      onClick={() => handleDeleteGroup()}
                      title="Supprimer la discussion"
                      className="flex h-9 items-center gap-1.5 px-2.5 sm:px-3 text-xs font-semibold rounded-lg border border-red-500/20 bg-red-500/5 hover:bg-red-500/15 hover:border-red-500/30 text-red-400 transition-all duration-200 cursor-pointer active:scale-95"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline whitespace-nowrap">Supprimer</span>
                    </button>
                  )}
                </div>
              </div>

              {/* MESSAGES THREAD */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-6 pt-10 pb-4 z-10 flex flex-col justify-end gap-4 relative">
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
                    const isImage = msg.content.startsWith("data:image/");
                    const userColor = getUserColor(msg.senderUsername);
                    const pickerOpen = reactionPickerFor === msg.id;

                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          "group flex flex-col max-w-[85%] sm:max-w-[75%] md:max-w-[65%] animate-in fade-in-50 duration-200 transition-opacity",
                          isMe ? "ml-auto items-end" : "mr-auto items-start",
                          msg.pending && "opacity-60"
                        )}
                      >
                        {/* Sender labels */}
                        <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/50 mb-1 px-1 select-none">
                          <span className={cn("font-semibold", isMe ? userColor.text : userColor.text)}>
                            {msg.senderUsername}
                          </span>
                          {isAdminSender && (
                            <span className="inline-flex items-center gap-0.5 text-[8.5px] font-bold px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/60 uppercase tracking-widest leading-none">
                              Admin
                            </span>
                          )}
                        </div>

                        {/* Bubble row — react button sits on the inner side, revealed on hover */}
                        <div className={cn("relative flex items-end gap-1", isMe ? "flex-row-reverse" : "flex-row")}>
                          <div
                            className={cn(
                              "rounded-2xl text-[13.5px] leading-relaxed shadow-md",
                              isImage ? "p-1.5 overflow-hidden" : "px-4 py-2.5",
                              isMe
                                ? cn(
                                    "text-white rounded-tr-none bg-gradient-to-br border shadow-md",
                                    userColor.bg,
                                    userColor.border,
                                    userColor.shadow
                                  )
                                : cn(
                                    "text-foreground rounded-tl-none border border-white/[0.07] backdrop-blur-sm",
                                    userColor.border,
                                    userColor.bgSubtle
                                  )
                            )}
                          >
                            {isImage ? (
                              <img
                                src={msg.content}
                                alt="Image envoyée"
                                className="max-w-full max-h-[260px] rounded-lg object-contain cursor-pointer hover:scale-[1.01] transition-transform duration-200"
                                onClick={() => {
                                  const w = window.open();
                                  if (w) w.document.write(`<img src="${msg.content}" style="max-width:100%; max-height:100vh; display:block; margin:auto;" />`);
                                }}
                              />
                            ) : (
                              <div className="whitespace-pre-wrap break-words break-all max-w-full">
                                {msg.content.startsWith("data:")
                                  ? "[Contenu média non supporté]"
                                  : msg.content}
                              </div>
                            )}
                          </div>

                          {!msg.pending && (
                            <button
                              type="button"
                              onClick={() => setReactionPickerFor(pickerOpen ? null : msg.id)}
                              title="Réagir"
                              className={cn(
                                "shrink-0 mb-0.5 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/40 hover:text-amber-400 hover:bg-white/[0.06] transition-all duration-150 cursor-pointer",
                                pickerOpen ? "opacity-100 bg-white/[0.06] text-amber-400" : "opacity-0 group-hover:opacity-100"
                              )}
                            >
                              <Smile className="h-4 w-4" />
                            </button>
                          )}

                          {pickerOpen && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setReactionPickerFor(null)} />
                              <div
                                className={cn(
                                  "absolute bottom-full mb-1.5 z-40 flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-[oklch(0.16_0.03_250)] px-1.5 py-1 shadow-2xl animate-in fade-in zoom-in-95 duration-150",
                                  isMe ? "right-0" : "left-0"
                                )}
                              >
                                {QUICK_REACTIONS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => toggleReaction(msg.id, emoji)}
                                    className="flex h-8 w-8 items-center justify-center text-lg rounded-full hover:bg-white/[0.08] hover:scale-125 transition-all duration-100 cursor-pointer"
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>

                        {/* Reaction pills */}
                        {msg.reactions.length > 0 && (
                          <div className={cn("flex flex-wrap gap-1 mt-1 px-1", isMe ? "justify-end" : "justify-start")}>
                            {msg.reactions.map((r) => (
                              <button
                                key={r.emoji}
                                type="button"
                                onClick={() => toggleReaction(msg.id, r.emoji)}
                                className={cn(
                                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer",
                                  r.mine
                                    ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                                    : "bg-white/[0.03] border-white/[0.08] text-muted-foreground/70 hover:bg-white/[0.06]"
                                )}
                              >
                                <span>{r.emoji}</span>
                                <span>{r.count}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Msg timestamp and read receipt */}
                        <div className="flex items-center gap-1.5 mt-1.5 px-1 select-none">
                          <span className="text-[9px] text-muted-foreground/35">
                            {new Date(msg.createdAt * 1000).toLocaleTimeString("fr-FR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {isMe && (
                            <div className="flex items-center">
                              {msg.pending ? (
                                <Loader2 className="h-3 w-3 text-muted-foreground/40 animate-spin" />
                              ) : msg.readAt ? (
                                <CheckCheck className="h-3 w-3 text-blue-400" />
                              ) : (
                                <Check className="h-3 w-3 text-muted-foreground/40" />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* INPUT BAR */}
              <div className="p-2.5 sm:p-4 border-t border-white/[0.06] bg-gradient-to-b from-transparent to-black/30 shrink-0 relative z-10">
                {/* Emoji Picker Popover */}
                {showEmojiPicker && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setShowEmojiPicker(false)}
                    />
                    <div className="absolute bottom-[4rem] sm:bottom-[4.5rem] left-1/2 -translate-x-1/2 z-40 bg-[oklch(0.16_0.03_250)] border border-white/[0.08] rounded-2xl shadow-2xl w-[min(21rem,calc(100vw-1.5rem))] animate-in fade-in slide-in-from-bottom-2 duration-150 overflow-hidden">
                      {/* Category tabs */}
                      <div className="flex items-center gap-1 p-2 border-b border-white/[0.06] overflow-x-auto scrollbar-none">
                        {EMOJI_CATEGORIES.map((cat, idx) => (
                          <button
                            key={cat.name}
                            type="button"
                            onClick={() => setActiveEmojiCategory(idx)}
                            title={cat.name}
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center text-[16px] rounded-xl transition-all duration-150 cursor-pointer",
                              idx === activeEmojiCategory
                                ? "bg-amber-500/15 border border-amber-500/25"
                                : "hover:bg-white/[0.06] border border-transparent"
                            )}
                          >
                            {cat.icon}
                          </button>
                        ))}
                      </div>
                      {/* Emoji grid */}
                      <div className="grid grid-cols-6 gap-1 p-2.5 max-h-52 overflow-y-auto">
                        {EMOJI_CATEGORIES[activeEmojiCategory].emojis.map((emoji, idx) => (
                          <button
                            key={`${emoji}-${idx}`}
                            type="button"
                            onClick={() => handleSelectEmoji(emoji)}
                            className="flex h-9 w-9 items-center justify-center text-[18px] rounded-xl hover:bg-white/[0.06] active:bg-white/[0.1] active:scale-95 transition-all duration-100 cursor-pointer"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Input Controls Strip */}
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleImageSelect}
                />

                {selectedImage && (
                  <div className="relative p-2.5 sm:p-3 mb-2 rounded-2xl border border-white/10 bg-white/[0.03] flex items-center gap-3 shrink-0">
                    <div className="relative h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-xl overflow-hidden border border-white/10 bg-black/40 shadow-inner">
                      <img src={selectedImage} alt="Aperçu" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setSelectedImage(null)}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Image prête à être envoyée. Appuyez sur envoyer pour l'expédier.
                    </div>
                      </div>
                    )}

                    <form
                      onSubmit={handleSendMessage}
                      className="flex items-end gap-1.5 sm:gap-2"
                    >
                      {/* WhatsApp-style rounded composer pill */}
                      <div className="flex flex-1 min-w-0 items-end gap-0.5 rounded-[26px] border border-white/[0.08] bg-white/[0.04] pl-1 pr-1 py-1 focus-within:border-amber-500/40 focus-within:bg-white/[0.06] transition-all duration-200 shadow-lg shadow-black/40">
                        {/* Smiley Button */}
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          title="Ajouter un emoji"
                          className={cn(
                            "flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full hover:bg-white/[0.06] text-muted-foreground hover:text-amber-400 transition-all duration-150 cursor-pointer active:scale-90",
                            showEmojiPicker && "text-amber-400 bg-white/[0.06]"
                          )}
                        >
                          <Smile className="h-5 w-5" />
                        </button>

                        <textarea
                          ref={textareaRef}
                          rows={1}
                          value={inputText}
                          onChange={(e) => {
                            setInputText(e.target.value);
                            notifyTyping();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage(e);
                            }
                          }}
                          placeholder={selectedImage ? "Ajouter un commentaire..." : "Message"}
                          className="flex-1 min-w-0 bg-transparent border-none text-[14px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-0 resize-none max-h-[7.5rem] overflow-y-auto leading-relaxed py-2"
                        />

                        {/* Paperclip/Image Attachment Button */}
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          title="Partager une image"
                          className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full hover:bg-white/[0.06] text-muted-foreground hover:text-amber-400 transition-all duration-150 cursor-pointer active:scale-90"
                        >
                          <Paperclip className="h-5 w-5" />
                        </button>
                      </div>

                      {/* Send button */}
                      <button
                        type="submit"
                        disabled={sending || (!inputText.trim() && !selectedImage)}
                        title="Envoyer"
                        className={cn(
                          "flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full transition-all duration-200 cursor-pointer active:scale-90 shadow-lg",
                          (inputText.trim() || selectedImage)
                            ? "bg-gradient-to-br from-amber-400 to-amber-600 hover:from-amber-500 hover:to-amber-700 text-black shadow-amber-950/30"
                            : "bg-white/5 text-muted-foreground cursor-not-allowed"
                        )}
                      >
                        {sending ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Send className="h-5 w-5 fill-current" />
                        )}
                      </button>
                    </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-muted-foreground/40 space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.02] border border-white/[0.05] text-muted-foreground/20">
                <MessageSquare className="h-7 w-7" />
              </div>
              <div className="text-sm font-semibold px-4">Sélectionnez un groupe ou un utilisateur pour commencer à échanger.</div>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* CREATE GROUP MODAL (Admin Only) */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-white/[0.08] bg-[oklch(0.15_0.03_250)] p-5 sm:p-6 shadow-2xl space-y-5 sm:space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-inner">
                <Plus className="h-5 w-5" />
              </div>
              <div className="min-w-0">
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
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-white/[0.08] bg-[oklch(0.15_0.03_250)] p-5 sm:p-6 shadow-2xl space-y-5 sm:space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-inner">
                <UserPlus className="h-5 w-5" />
              </div>
              <div className="min-w-0">
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
