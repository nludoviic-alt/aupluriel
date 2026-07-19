import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
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
  Search,
  ChevronRight,
  ChevronLeft,
  Bell,
  Paperclip,
  Check,
  CheckCheck,
  Square,
  CircleDot,
  Ban,
  Reply,
  Forward,
  Copy,
  Pencil,
  Video,
  Phone,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useVisualViewportFrame } from "@/hooks/use-keyboard-open";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getExistingPushSubscription, isIosNonSafari, isIosNonStandalone, isPushSupported, subscribeToPush } from "@/lib/push";

export const Route = createFileRoute("/messenger")({
  head: () => ({ meta: [{ title: "Messagerie — Au Pluriel" }] }),
  component: MessengerPage,
});

interface ChatGroupLastMessage {
  content: string;
  createdAt: number;
  senderId: number;
  isImage: boolean;
}

interface ChatGroup {
  id: string;
  name: string;
  isDirect: number;
  recipientId: number | null;
  createdBy: number | null;
  createdAt: number;
  lastMessage: ChatGroupLastMessage | null;
  unreadCount: number;
  avatar?: string;
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
  deliveredAt: number | null;
  editedAt: number | null;
  deletedAt: number | null;
  senderUsername: string;
  senderIsAdmin: number;
  senderAvatar?: string | null;
  reactions: MessageReaction[];
  replyToId: string | null;
  replyToContent: string | null;
  replyToSenderUsername: string | null;
  pending?: boolean; // optimistic send — not yet confirmed by the server
}

interface VerifiedUser {
  id: number;
  username: string;
  email: string;
  avatar: string | null;
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

// Telegram-style consecutive-message grouping: same sender, no date
// separator between them, within this many seconds of each other.
const MESSAGE_GROUP_GAP_SECONDS = 60;
function isGroupedMessagePair(a: ChatMessage | undefined, b: ChatMessage | undefined): boolean {
  if (!a || !b) return false;
  if (a.senderId !== b.senderId) return false;
  if (!isSameDay(a.createdAt, b.createdAt)) return false;
  return Math.abs(b.createdAt - a.createdAt) < MESSAGE_GROUP_GAP_SECONDS;
}

// Positions the mobile full-screen context menu next to the bubble's
// captured on-screen rect — flips above/below depending on available
// space so it's never pushed off-screen top or bottom.
function getMobileContextMenuStyle(
  anchor: { top: number; bottom: number; left: number; right: number },
  isMe: boolean
): React.CSSProperties {
  const estimatedHeight = 320;
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  const margin = 16;

  const showAbove = anchor.bottom + estimatedHeight > viewportH - margin;
  const vertical: React.CSSProperties = showAbove
    ? { bottom: `${Math.max(margin, viewportH - anchor.top + 8)}px` }
    : { top: `${Math.min(viewportH - margin, anchor.bottom + 8)}px` };

  const horizontal: React.CSSProperties = isMe
    ? { right: `${Math.max(margin, viewportW - anchor.right)}px` }
    : { left: `${Math.max(margin, anchor.left)}px` };

  return { ...vertical, ...horizontal };
}

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

// Detect if the message contains only 1 to 3 emojis
function getEmojiOnlyCount(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Split string into visual characters
  const symbols = Array.from(trimmed);
  if (symbols.length > 3) return null;

  // Pattern matching standard emoji ranges
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F018}-\u{1F0F5}]|[\u{1F004}]|[\u{1F0CF}-\u{1F170}]/u;

  const isAllEmoji = symbols.every(sym => emojiRegex.test(sym));
  if (isAllEmoji) {
    return symbols.length;
  }
  return null;
}

function parseInlineFormats(text: string, partIndex: number) {
  const regex = /(`[^`]+`|\*[^*]+\*|_[^_]+_|~[^~]+~)/g;
  const tokens = text.split(regex);

  if (tokens.length === 1) return text;

  return tokens.map((token, tokenIndex) => {
    const key = `${partIndex}-${tokenIndex}`;
    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <code key={key} className="bg-white/10 px-1.5 py-0.5 rounded text-xs font-mono text-amber-300">
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith("*") && token.endsWith("*")) {
      return (
        <strong key={key} className="font-bold">
          {token.slice(1, -1)}
        </strong>
      );
    }
    if (token.startsWith("_") && token.endsWith("_")) {
      return (
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    }
    if (token.startsWith("~") && token.endsWith("~")) {
      return (
        <span key={key} className="line-through opacity-70">
          {token.slice(1, -1)}
        </span>
      );
    }
    return token;
  });
}

function isSameDay(a: number, b: number) {
  const da = new Date(a * 1000);
  const db = new Date(b * 1000);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

// "Aujourd'hui" / "Hier" / full date, WhatsApp-style separator label
function formatDateSeparator(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = Date.now() / 1000;
  if (isSameDay(timestamp, now)) return "Aujourd'hui";
  if (isSameDay(timestamp, now - 86400)) return "Hier";
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Sidebar row timestamp — Telegram/WhatsApp convention: bare time today,
// short date otherwise.
function formatSidebarTime(timestamp: number): string {
  const now = Date.now() / 1000;
  return isSameDay(timestamp, now)
    ? new Date(timestamp * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : new Date(timestamp * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// Sidebar row preview text — real last message instead of a placeholder,
// with the "Vous : " prefix and photo/truncation handling chat apps use.
function formatSidebarPreview(
  lastMessage: ChatGroupLastMessage | null | undefined,
  currentUserId: number | undefined
): string | undefined {
  if (!lastMessage) return undefined;
  const prefix = lastMessage.senderId === currentUserId ? "Vous : " : "";
  if (lastMessage.isImage) return `${prefix}📷 Photo`;
  const text = lastMessage.content.length > 42 ? `${lastMessage.content.slice(0, 42)}…` : lastMessage.content;
  return `${prefix}${text}`;
}

// Custom parser for WhatsApp styles
function formatMessageContent(text: string) {
  if (text.startsWith("data:")) return "[Contenu média non supporté]";

  // Detect and format links first (convert to anchor tags)
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-amber-400 hover:underline break-all"
        >
          {part}
        </a>
      );
    }
    return parseInlineFormats(part, index);
  });
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

  // Focusing the composer on iOS Safari makes it scroll the whole document
  // to keep the input above the keyboard — this happens at the WebKit/
  // visual-viewport level and, critically, `overflow: hidden` alone does
  // NOT stop it (Safari treats the page as scrollable for keyboard-avoidance
  // purposes regardless of CSS overflow), leaving the chat card scrolled out
  // of view — a blank gap, composer nowhere to be seen. Pinning body to
  // `position: fixed` on mobile removes the scrollable box entirely, so there
  // is nothing left for Safari to scroll against. Self-contained to this page
  // — mounted/unmounted only while messenger is the active route. Desktop
  // keeps normal document flow (md+).
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const mq = window.matchMedia("(max-width: 767px)");

    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyBottom: body.style.bottom,
      bodyWidth: body.style.width,
    };

    const applyMobileLock = () => {
      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
      if (mq.matches) {
        body.style.position = "fixed";
        body.style.top = "0";
        body.style.left = "0";
        body.style.right = "0";
        body.style.bottom = "0";
        body.style.width = "100%";
      } else {
        body.style.position = prev.bodyPosition;
        body.style.top = prev.bodyTop;
        body.style.left = prev.bodyLeft;
        body.style.right = prev.bodyRight;
        body.style.bottom = prev.bodyBottom;
        body.style.width = prev.bodyWidth;
      }
    };

    applyMobileLock();
    mq.addEventListener("change", applyMobileLock);

    return () => {
      mq.removeEventListener("change", applyMobileLock);
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.position = prev.bodyPosition;
      body.style.top = prev.bodyTop;
      body.style.left = prev.bodyLeft;
      body.style.right = prev.bodyRight;
      body.style.bottom = prev.bodyBottom;
      body.style.width = prev.bodyWidth;
    };
  }, []);



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

  const [sidebarSearch, setSidebarSearch] = useState("");
  const [sidebarFilter, setSidebarFilter] = useState<"all" | "personal" | "groups">("all");

  // Track if a conversation is active on mobile to hide the bottom nav bar
  useEffect(() => {
    if (activeGroupId) {
      document.body.classList.add("chat-active");
    } else {
      document.body.classList.remove("chat-active");
    }
    return () => {
      document.body.classList.remove("chat-active");
    };
  }, [activeGroupId]);

  // Body lock is permanent on mobile while messenger is mounted — focus/blur
  // no longer toggle position:fixed (that caused overflow reset races).

  // Clipboard Paste Image upload handler
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
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
              ctx?.drawImage(img, 0, 0, width, height);
              const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
              setSelectedImage(dataUrl);
              toast.success("Image collée depuis le presse-papier !");
            };
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    }
  };

  // Auto-grow the composer textarea like WhatsApp — ~6 lines on mobile
  // (taller line-height), ~5 lines desktop. Cap kept in sync with max-h CSS.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    const maxHeight = isMobile ? 156 : 120;
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${newHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [inputText]);

  // Emoji picker popover state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState(0);

  // Per-message action menu (WhatsApp-style: id of the message whose
  // reaction strip + action list is currently open, null when none is).
  // Opened by clicking the reveal-on-hover button (desktop) or a long-press
  // on the bubble (touch).
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  // Bubble's on-screen position when its menu opened, captured once so the
  // mobile full-screen context menu (rendered via fixed positioning, to
  // escape the scrollable thread's clipping) can anchor near it regardless
  // of scroll. Unused on desktop, which keeps its small anchored popover.
  const [contextMenuAnchor, setContextMenuAnchor] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null);
  // Full emoji grid for reacting (mobile menu's "+" past the 6 quick
  // reactions) — id of the message it's open for, reusing EMOJI_CATEGORIES.
  const [reactionEmojiPickerFor, setReactionEmojiPickerFor] = useState<string | null>(null);
  const [reactionEmojiCategory, setReactionEmojiCategory] = useState(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressMovedRef = useRef(false);
  // True once the long-press timer actually fired — lets touchend suppress
  // the browser's synthetic "click" that follows a touch sequence, which
  // otherwise immediately reopened the image lightbox right on top of the
  // reaction picker we just opened (images have their own onClick to zoom).
  const longPressFiredRef = useRef(false);

  // Reply-to-message composer state — the message currently being quoted
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  // Edit-message composer state — the message currently being edited
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  // Forward-message modal state — the message currently being forwarded
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [forwardTargetId, setForwardTargetId] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState(false);

  // Refs to each rendered message bubble, so a quoted-reply preview can
  // scroll the original message into view when tapped.
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Swipe-right-to-reply (WhatsApp-style). Manipulates the bubble's transform
  // directly via refs during the drag instead of React state, so dragging
  // doesn't re-render the whole message list on every touchmove.
  const bubbleRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const swipeIconRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const swipeStateRef = useRef<{ id: string; startX: number; startY: number; dragX: number; horizontal: boolean } | null>(null);
  const SWIPE_TRIGGER_PX = 56;
  const SWIPE_MAX_PX = 72;

  function handleSwipeTouchStart(e: React.TouchEvent, messageId: string) {
    swipeStateRef.current = {
      id: messageId,
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      dragX: 0,
      horizontal: false,
    };
  }

  function handleSwipeTouchMove(e: React.TouchEvent, messageId: string) {
    const s = swipeStateRef.current;
    if (!s || s.id !== messageId) return;
    const deltaX = e.touches[0].clientX - s.startX;
    const deltaY = e.touches[0].clientY - s.startY;

    if (!s.horizontal) {
      // Wait for a clear enough gesture before committing to horizontal —
      // avoids hijacking what's really a vertical scroll or a tap.
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return;
      if (Math.abs(deltaY) >= Math.abs(deltaX)) return; // vertical scroll wins, let it pass through
      s.horizontal = true;
    }

    // Only rightward, clamped — same feel as WhatsApp's reply reveal.
    s.dragX = Math.max(0, Math.min(SWIPE_MAX_PX, deltaX));
    const bubble = bubbleRowRefs.current.get(messageId);
    const icon = swipeIconRefs.current.get(messageId);
    if (bubble) bubble.style.transform = `translateX(${s.dragX}px)`;
    if (icon) icon.style.opacity = String(Math.min(1, s.dragX / (SWIPE_TRIGGER_PX * 0.85)));
  }

  function handleSwipeTouchEnd(messageId: string, msg: ChatMessage) {
    const s = swipeStateRef.current;
    swipeStateRef.current = null;
    if (!s || s.id !== messageId) return;

    const bubble = bubbleRowRefs.current.get(messageId);
    const icon = swipeIconRefs.current.get(messageId);
    if (bubble) {
      bubble.style.transition = "transform 200ms ease-out";
      bubble.style.transform = "translateX(0px)";
      setTimeout(() => { if (bubble) bubble.style.transition = ""; }, 220);
    }
    if (icon) icon.style.opacity = "0";

    if (s.dragX > SWIPE_TRIGGER_PX) {
      if (typeof navigator.vibrate === "function") navigator.vibrate(15);
      startReplyMessage(msg);
    }
  }

  function openMessageMenu(messageId: string) {
    const rect = bubbleRowRefs.current.get(messageId)?.getBoundingClientRect();
    if (rect) setContextMenuAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
    setReactionPickerFor(messageId);
  }
  function closeMessageMenu() {
    setReactionPickerFor(null);
    setContextMenuAnchor(null);
  }

  function startLongPress(messageId: string) {
    longPressMovedRef.current = false;
    longPressFiredRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      if (!longPressMovedRef.current) {
        longPressFiredRef.current = true;
        if (typeof navigator.vibrate === "function") navigator.vibrate(15);
        openMessageMenu(messageId);
      }
    }, 450);
  }
  function cancelLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // Image upload states & ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  // Lightbox Zoom and Pan states
  const [lightboxScale, setLightboxScale] = useState(1);
  const [lightboxOffset, setLightboxOffset] = useState({ x: 0, y: 0 });
  const lastTouchRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isPanningRef = useRef(false);

  // Swipe-down-to-dismiss for the fullscreen image (WhatsApp-style)
  const [lightboxDragY, setLightboxDragY] = useState(0);
  const [lightboxDragging, setLightboxDragging] = useState(false);
  const lightboxDragStartRef = useRef<{ x: number; y: number } | null>(null);

  function handleLightboxTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    const now = Date.now();
    
    // Double tap detection
    if (lastTouchRef.current && now - lastTouchRef.current.time < 300) {
      const dist = Math.hypot(touch.clientX - lastTouchRef.current.x, touch.clientY - lastTouchRef.current.y);
      if (dist < 30) {
        if (lightboxScale > 1) {
          setLightboxScale(1);
          setLightboxOffset({ x: 0, y: 0 });
        } else {
          setLightboxScale(2.5);
        }
        lastTouchRef.current = null;
        return;
      }
    }
    
    lastTouchRef.current = { x: touch.clientX, y: touch.clientY, time: now };
    lightboxDragStartRef.current = { x: touch.clientX, y: touch.clientY };
    setLightboxDragging(true);
    
    if (lightboxScale > 1) {
      isPanningRef.current = true;
    }
  }

  function handleLightboxTouchMove(e: React.TouchEvent) {
    if (!lightboxDragStartRef.current) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - lightboxDragStartRef.current.x;
    const deltaY = touch.clientY - lightboxDragStartRef.current.y;

    if (lightboxScale > 1) {
      // Panning mode
      setLightboxOffset(prev => ({
        x: prev.x + deltaX,
        y: prev.y + deltaY
      }));
      lightboxDragStartRef.current = { x: touch.clientX, y: touch.clientY };
    } else {
      // Dismiss drag mode
      if (deltaY > 0) {
        setLightboxDragY(deltaY);
      }
    }
  }

  function handleLightboxTouchEnd() {
    lightboxDragStartRef.current = null;
    setLightboxDragging(false);
    isPanningRef.current = false;

    if (lightboxScale === 1) {
      if (lightboxDragY > 110) {
        setFullscreenImage(null);
        setLightboxDragY(0);
      } else {
        setLightboxDragY(0);
      }
    } else {
      // Clamp offset when zoomed to keep image in view (simple version)
      // If we wanted to be perfect we'd calculate bounds based on image size vs screen
    }
  }

  // Listen for Escape key to close fullscreen image
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFullscreenImage(null);
      }
    };
    if (fullscreenImage) {
      window.addEventListener("keydown", handleKeyDown);
    } else {
      setLightboxDragY(0);
      setLightboxScale(1);
      setLightboxOffset({ x: 0, y: 0 });
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fullscreenImage]);

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

  // Scroll to bottom button visibility
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const messagesThreadRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);

  const handleThreadScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const isScrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight > 400;
    setShowScrollBottom(isScrolledUp);
  };
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

  // Scroll window to top on mount to reset any page scroll offset
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

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
        setTimeout(() => scrollToBottom(true), 60);
        
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
              setTimeout(() => scrollToBottom(false), 50);
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

  function scrollToBottom(instant = false) {
    const el = messagesThreadRef.current;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: instant ? "auto" : "smooth"
      });
    }
  }

  // Keyboard opening / visualViewport resize shrinks the thread — keep the
  // latest messages in view, like Telegram. Height changes also fire while
  // the user types multilines and the composer auto-grows.
  const { keyboardOpen, height: vvHeight } = useVisualViewportFrame();
  useEffect(() => {
    if (keyboardOpen) {
      document.body.classList.add("keyboard-open");
    } else {
      document.body.classList.remove("keyboard-open");
    }
    return () => {
      document.body.classList.remove("keyboard-open");
    };
  }, [keyboardOpen]);
  useEffect(() => {
    if (!keyboardOpen) return;
    const t = setTimeout(() => scrollToBottom(true), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardOpen, vvHeight]);

  // Handle message send
  // Sends one piece of content optimistically: it appears in the thread
  // immediately (dimmed, single check) and swaps in for the server's real
  // row the moment the request resolves — no waiting for the next poll.
  async function sendOptimistic(groupId: string, content: string, replyTo?: ChatMessage | null) {
    if (!user) return;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMessage = {
      id: tempId,
      groupId,
      senderId: user.id,
      content,
      createdAt: Math.floor(Date.now() / 1000),
      readAt: null,
      deliveredAt: null,
      editedAt: null,
      deletedAt: null,
      senderUsername: user.username,
      senderIsAdmin: user.is_admin ?? 0,
      senderAvatar: user.avatar,
      reactions: [],
      replyToId: replyTo?.id ?? null,
      replyToContent: replyTo?.content ?? null,
      replyToSenderUsername: replyTo?.senderUsername ?? null,
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setTimeout(() => scrollToBottom(false), 50);
    try {
      const newMsg = await api.post<ChatMessage>("/api/chat/messages", {
        groupId,
        content,
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      });
      setMessages((prev) => prev.map((m) => (m.id === tempId ? newMsg : m)));
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      throw err;
    }
  }

  function cancelEdit() {
    setEditingMessage(null);
    setInputText("");
  }

  function cancelReply() {
    setReplyingTo(null);
  }

  async function handleSendMessage(e?: React.SyntheticEvent) {
    e?.preventDefault();
    if (!activeGroupId || sending) return;

    if (editingMessage) {
      const content = inputText.trim();
      if (content === "") return;
      setSending(true);
      try {
        const res = await api.patch<{ editedAt: number }>("/api/chat/messages", {
          groupId: activeGroupId,
          messageId: editingMessage.id,
          content,
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === editingMessage.id ? { ...m, content, editedAt: res.editedAt } : m))
        );
        cancelEdit();
      } catch (err: any) {
        toast.error(err.message || "Impossible de modifier le message");
      } finally {
        setSending(false);
      }
      return;
    }

    if (inputText.trim() === "" && !selectedImage) return;

    setShowEmojiPicker(false);
    setSending(true);
    const replyTo = replyingTo;
    setReplyingTo(null);

    try {
      if (selectedImage) {
        const image = selectedImage;
        setSelectedImage(null);
        await sendOptimistic(activeGroupId, image, replyTo);
      }

      if (inputText.trim() !== "") {
        const content = inputText.trim();
        setInputText("");
        await sendOptimistic(activeGroupId, content, replyTo);
      }
    } catch (err: any) {
      toast.error(err.message || "Erreur d'envoi");
    } finally {
      setSending(false);
    }
  }

  function startEditMessage(msg: ChatMessage) {
    setReplyingTo(null);
    setEditingMessage(msg);
    setInputText(msg.content);
    setReactionPickerFor(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function startReplyMessage(msg: ChatMessage) {
    setEditingMessage(null);
    setReplyingTo(msg);
    setReactionPickerFor(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function copyMessageText(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Texte copié !");
    } catch {
      toast.error("Impossible de copier le texte");
    }
    setReactionPickerFor(null);
  }

  async function deleteMessage(msg: ChatMessage) {
    setReactionPickerFor(null);
    if (!activeGroupId) return;
    if (!window.confirm("Supprimer ce message pour tout le monde ? Cette action est irréversible.")) return;
    try {
      const res = await api.delete<{ deletedAt: number }>("/api/chat/messages", {
        groupId: activeGroupId,
        messageId: msg.id,
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, content: "", deletedAt: res.deletedAt } : m))
      );
      if (editingMessage?.id === msg.id) cancelEdit();
    } catch (err: any) {
      toast.error(err.message || "Impossible de supprimer le message");
    }
  }

  function openForwardModal(msg: ChatMessage) {
    setReactionPickerFor(null);
    setForwardingMessage(msg);
    setForwardTargetId(null);
  }

  async function confirmForward() {
    if (!forwardingMessage || !forwardTargetId) return;
    setForwarding(true);
    try {
      if (forwardTargetId === activeGroupId) {
        await sendOptimistic(forwardTargetId, forwardingMessage.content);
      } else {
        await api.post("/api/chat/messages", { groupId: forwardTargetId, content: forwardingMessage.content });
      }
      toast.success("Message transféré !");
      setForwardingMessage(null);
      setForwardTargetId(null);
    } catch (err: any) {
      toast.error(err.message || "Impossible de transférer le message");
    } finally {
      setForwarding(false);
    }
  }

  function scrollToMessage(messageId: string) {
    const el = messageRefs.current.get(messageId);
    const container = messagesThreadRef.current;
    if (!el || !container) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const relativeTop = elRect.top - containerRect.top + container.scrollTop;
    const targetScrollTop = relativeTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({
      top: targetScrollTop,
      behavior: "smooth"
    });
    el.classList.add("ring-2", "ring-amber-400/60");
    setTimeout(() => el.classList.remove("ring-2", "ring-amber-400/60"), 900);
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
    const el = textareaRef.current;
    if (!el) {
      setInputText((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);
    const newText = before + emoji + after;
    setInputText(newText);
    
    // Remettre le focus et replacer le curseur juste après l'emoji inséré
    setTimeout(() => {
      el.focus();
      const newCursorPos = start + emoji.length;
      el.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
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

  const groupsWithAvatars = groups.map((g) => {
    if (g.isDirect && g.recipientId) {
      const u = verifiedUsers.find((v) => v.id === g.recipientId);
      if (u?.avatar) return { ...g, avatar: u.avatar };
    }
    return g;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden min-h-0 bg-[#050505] md:p-4 lg:p-6">
      {/* Main Premium Container — floating card effect on desktop */}
      <div className="flex flex-col flex-1 min-h-0 w-full md:max-w-[1280px] md:mx-auto md:rounded-[32px] border border-white/[0.06] bg-[#0a0a0c] shadow-2xl overflow-hidden relative">
        {/* Subtle Ambient background flares within the container */}
        <div className="pointer-events-none absolute -top-40 -left-40 w-[500px] h-[500px] bg-amber-500/[0.04] blur-[120px] rounded-full" />
        <div className="pointer-events-none absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-violet-600/[0.04] blur-[120px] rounded-full" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/[0.02] blur-[140px] rounded-full" />

        {/* HEADER SECTION - Hidden on mobile if a discussion is active to save height */}
        <div className={cn(
          "items-center justify-between border-b border-white/[0.06] bg-[#0a0a0c]/80 backdrop-blur-2xl px-5 py-3.5 md:px-6 md:py-4 shrink-0 sticky top-0 z-[100] pt-[env(safe-area-inset-top)] md:pt-4",
          activeGroupId ? "hidden md:flex" : "flex"
        )}>
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="flex h-10 w-10 md:h-11 md:w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/10 border border-amber-500/20 text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.1)] shrink-0">
            <MessageSquare className="h-5 w-5 md:h-5.5 md:w-5.5" />
          </div>
          <div className="min-w-0 flex flex-col justify-center">
            <h1 className="text-lg md:text-2xl font-black tracking-tight text-foreground font-sans truncate leading-none mb-1">Messages</h1>
            <div className="flex items-center gap-1.5">
              <span className="flex h-1 w-1 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
              <p className="text-[9px] md:text-xs text-muted-foreground/50 font-black truncate leading-none uppercase tracking-[0.15em]">Réseau Sécurisé</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {!!user?.is_admin && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex h-10 md:h-11 items-center justify-center gap-2 px-4 md:px-5 text-[13px] font-bold rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-black shadow-xl shadow-amber-950/20 transition-all duration-300 cursor-pointer shrink-0 active:scale-95 hover:scale-[1.02] border border-amber-300/10"
              title="Créer un groupe"
            >
              <Plus className="h-4.5 w-4.5 shrink-0" />
              <span className="hidden md:inline whitespace-nowrap">Nouveau Groupe</span>
            </button>
          )}
        </div>
      </div>

      {/* CHAT WORKSPACE */}
      <div className="flex flex-1 min-h-0 divide-x divide-white/[0.06] overflow-hidden">
        {/* SIDEBAR COL */}
        <div className={cn("flex flex-col bg-white/[0.01] overflow-hidden space-y-0", activeGroupId ? "hidden md:flex md:w-[350px] shrink-0" : "w-full md:w-[350px] shrink-0")}>
          {/* SEARCH BAR */}
          <div className="px-4 py-3">
            <div className="relative group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/20 group-focus-within:text-amber-500/50 transition-colors" />
              <input 
                type="text"
                placeholder="Rechercher une discussion..."
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                disabled={!!activeGroupId}
                className="w-full bg-white/[0.03] border border-white/[0.05] rounded-2xl py-2.5 pl-10 pr-4 text-[15px] placeholder:text-muted-foreground/20 focus:outline-none focus:border-amber-500/20 focus:bg-white/[0.05] transition-all"
              />
            </div>
          </div>

          {/* FILTER TABS */}
          <div className="flex items-center gap-1.5 px-4 pb-3 overflow-x-auto scrollbar-none shrink-0">
            {[
              { id: "all", label: "Tous" },
              { id: "personal", label: "Privés" },
              { id: "groups", label: "Groupes" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSidebarFilter(tab.id as any)}
                className={cn(
                  "flex-1 flex items-center justify-center px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap active:scale-95 cursor-pointer border",
                  sidebarFilter === tab.id
                    ? "bg-amber-500/10 border-amber-500/20 text-amber-400 shadow-[0_2px_10px_-4px_rgba(245,158,11,0.2)]"
                    : "bg-white/[0.02] border-white/[0.05] text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-white/[0.04]"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-2 sm:px-3 pb-4">
            {loadingSidebar ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className="h-16 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.02]"
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {(() => {
                  // Combine all potential conversation rows
                  const allRows: Array<{
                    id: string;
                    name: string;
                    type: "group" | "personal";
                    lastMessage?: string;
                    time?: string;
                    unread?: number;
                    avatar?: string;
                    isActive: boolean;
                    onClick: () => void;
                  }> = [];

                  // Public Groups
                  if (sidebarFilter === "all" || sidebarFilter === "groups") {
                    publicGroups.forEach(g => {
                      if (sidebarSearch && !g.name.toLowerCase().includes(sidebarSearch.toLowerCase())) return;
                      allRows.push({
                        id: g.id,
                        name: g.name,
                        type: "group",
                        lastMessage: formatSidebarPreview(g.lastMessage, user?.id),
                        time: formatSidebarTime(g.lastMessage?.createdAt ?? g.createdAt),
                        unread: g.unreadCount,
                        isActive: g.id === activeGroupId,
                        onClick: () => setActiveGroupId(g.id)
                      });
                    });
                  }

                  // Personal / DMs
                  if (sidebarFilter === "all" || sidebarFilter === "personal") {
                    if (!!user?.is_admin) {
                      verifiedUsers.forEach(u => {
                        if (sidebarSearch && !u.username.toLowerCase().includes(sidebarSearch.toLowerCase())) return;
                        // The DM's preview/unread data lives on the matching chat_groups
                        // row (is_direct=1), not on the /api/chat/users row itself.
                        const dmGroup = groups.find((g) => g.id === u.groupId);
                        allRows.push({
                          id: u.groupId,
                          name: u.username,
                          type: "personal",
                          lastMessage: dmGroup ? formatSidebarPreview(dmGroup.lastMessage, user?.id) : u.email,
                          time: dmGroup ? formatSidebarTime(dmGroup.lastMessage?.createdAt ?? dmGroup.createdAt) : undefined,
                          unread: dmGroup?.unreadCount,
                          avatar: u.avatar || u.username,
                          isActive: u.groupId === activeGroupId,
                          onClick: () => setActiveGroupId(u.groupId)
                        });
                      });
                    } else if (userDmGroup) {
                      if (!sidebarSearch || userDmGroup.name.toLowerCase().includes(sidebarSearch.toLowerCase())) {
                        allRows.push({
                          id: userDmGroup.id,
                          name: "Support Admin",
                          type: "personal",
                          lastMessage: formatSidebarPreview(userDmGroup.lastMessage, user?.id) ?? "Discussion privée",
                          time: formatSidebarTime(userDmGroup.lastMessage?.createdAt ?? userDmGroup.createdAt),
                          unread: userDmGroup.unreadCount,
                          isActive: userDmGroup.id === activeGroupId,
                          onClick: () => setActiveGroupId(userDmGroup.id)
                        });
                      }
                    }
                  }

                  if (allRows.length === 0) {
                    return (
                      <div className="py-20 flex flex-col items-center justify-center text-center space-y-3 px-6">
                        <div className="h-12 w-12 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-center text-muted-foreground/20">
                          <Search className="h-6 w-6" />
                        </div>
                        <p className="text-sm text-muted-foreground/40 font-medium">Aucun résultat trouvé</p>
                      </div>
                    );
                  }

                  return allRows.map((row) => {
                    const isOnline = row.type === "personal" && row.id && verifiedUsers.find(u => u.groupId === row.id && onlineUserIds.has(u.id));
                    return (
                      <button
                        key={row.id}
                        onClick={row.onClick}
                        className={cn(
                          "w-full flex items-center gap-3.5 p-3 sm:p-4 rounded-[22px] border transition-all duration-300 text-left relative cursor-pointer group/row mb-2",
                          row.isActive
                            ? "bg-gradient-to-br from-amber-500/15 to-orange-500/5 border-amber-500/30 shadow-[0_8px_20px_-8px_rgba(245,158,11,0.2)]"
                            : "bg-white/[0.02] border-white/[0.04] text-muted-foreground hover:bg-white/[0.04] hover:border-white/[0.08]"
                        )}
                      >
                        <div className="relative shrink-0">
                          <div className={cn(
                            "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-sm font-black shadow-lg transition-all duration-300 group-hover/row:scale-105 overflow-hidden bg-background",
                            row.type === "personal"
                              ? (row.avatar && row.avatar.startsWith("http") ? "border-white/10" : cn("bg-gradient-to-br border-white/5", getAvatarStyle(row.avatar || row.name)))
                              : "bg-amber-500/10 border-amber-500/20 text-amber-400",
                            isOnline && "ring-2 ring-emerald-500/20 ring-offset-2 ring-offset-[#0a0a0c]"
                          )}>
                            {row.type === "personal" ? (
                              row.avatar && row.avatar.startsWith("http") ? (
                                <img src={row.avatar} alt={row.name} className="w-full h-full object-cover" />
                              ) : (
                                getInitial(row.avatar || row.name)
                              )
                            ) : (
                              <Hash className="h-5.5 w-5.5" strokeWidth={2.5} />
                            )}
                          </div>
                          {isOnline && (
                            <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#0a0a0c] bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                          )}
                        </div>
                        
                        <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className={cn(
                              "font-black text-[15px] leading-tight truncate tracking-tight",
                              row.isActive ? "text-amber-400" : "text-white/90"
                            )}>
                              {row.name}
                            </div>
                            {row.time && (
                              <div className="text-[10px] font-bold text-muted-foreground/30 uppercase tracking-wider">
                                {row.time}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className={cn(
                              "text-[13px] truncate leading-snug font-medium",
                              row.isActive ? "text-white/60" : "text-white/30"
                            )}>
                              {row.lastMessage}
                            </div>
                            {!!row.unread && row.unread > 0 && (
                              <div className="h-5 min-w-[1.25rem] px-1.5 flex items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-[10px] font-black text-black shadow-[0_4px_10px_-2px_rgba(245,158,11,0.4)] animate-in zoom-in duration-300">
                                {row.unread}
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Selected Indicator Dot */}
                        {row.isActive && (
                          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-amber-500 rounded-l-full shadow-[0_0_12px_rgba(245,158,11,0.5)]" />
                        )}
                      </button>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </div>

        {/* CHAT WINDOW */}
        <div className={cn("flex-1 flex flex-col bg-background/40 overflow-hidden relative min-h-0", activeGroupId ? "flex" : "hidden md:flex")}>
          {/* Subtle Wallpaper Pattern (WhatsApp style) */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none select-none" 
               style={{ backgroundImage: `url("https://www.transparenttextures.com/patterns/cubes.png")` }} />
          
          {/* Subtle Ambient Background glow blobs */}
          <div className="pointer-events-none absolute -bottom-32 -right-32 h-72 w-72 rounded-full bg-amber-500/[0.02] blur-[90px]" />
          <div className="pointer-events-none absolute -top-32 -left-32 h-72 w-72 rounded-full bg-violet-500/[0.02] blur-[90px]" />

          {activeGroupId ? (
            <>
              {/* CHAT WINDOW HEADER */}
              <div className="relative flex items-center justify-between gap-3 border-b border-white/[0.06] md:border-b-white/[0.1] bg-gradient-to-b from-[#0a0a0c]/95 via-[#0a0a0c]/90 to-[#0a0a0c]/80 md:bg-black/60 backdrop-blur-2xl px-3 sm:px-6 py-3 sm:py-3.5 pt-[env(safe-area-inset-top)] md:pt-3 shrink-0 z-[100] sticky top-0 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.45)] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-amber-500/25 after:to-transparent md:after:hidden">
                <div className="flex items-center min-w-0 flex-1">
                  <button
                    onClick={() => setActiveGroupId(null)}
                    className="md:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.04] border border-white/[0.08] text-amber-400 hover:text-amber-300 hover:bg-white/[0.08] hover:border-white/[0.12] transition-all active:scale-90 mr-2.5"
                    title="Retour"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  
                  <div className="relative shrink-0">
                    <div className={cn(
                      "flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full border text-sm font-bold shadow-lg transition-transform duration-200 overflow-hidden bg-background ring-2 ring-white/5",
                      isActiveDirect ? "border-white/10" : "border-amber-500/20 bg-amber-500/10 text-amber-400"
                    )}>
                      {isActiveDirect ? (
                        activeGroupId && groupsWithAvatars.find(g => g.id === activeGroupId)?.avatar ? (
                          <img src={groupsWithAvatars.find(g => g.id === activeGroupId)?.avatar} alt={activeGroupName} className="w-full h-full object-cover" />
                        ) : (
                          <div className={cn("w-full h-full flex items-center justify-center bg-gradient-to-br", getAvatarStyle(activeGroupName))}>
                            {getInitial(activeGroupName)}
                          </div>
                        )
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-amber-500/10 border-amber-500/20 text-amber-400">
                          <Hash className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 flex flex-col justify-center ml-3">
                    <h2 className="font-black text-[17px] sm:text-lg bg-gradient-to-r from-white via-white to-white/80 bg-clip-text text-transparent tracking-tight font-sans truncate leading-tight">
                      {activeGroupName}
                    </h2>
                    
                    <div className="flex items-center gap-1.5 h-3.5 mt-0.5">
                      {typingUserIds.length > 0 ? (
                        <span className="text-[11.5px] font-medium text-amber-400 animate-in fade-in">
                          {typingLabel}
                        </span>
                      ) : (
                        activePartnerId !== undefined && (
                          <span className={cn(
                            "text-[11px] sm:text-xs font-medium transition-colors flex items-center gap-1.5 leading-none",
                            onlineUserIds.has(activePartnerId) ? "text-emerald-400/90" : "text-muted-foreground/50"
                          )}>
                            <span className={cn(
                              "h-1.5 w-1.5 rounded-full shrink-0",
                              onlineUserIds.has(activePartnerId)
                                ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)] animate-pulse"
                                : "bg-muted-foreground/35"
                            )} />
                            {onlineUserIds.has(activePartnerId) ? "En ligne" : "Hors ligne"}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!isActiveDirect && !!user?.is_admin && (
                    <button
                      onClick={handleOpenMembersModal}
                      title="Gérer les membres"
                      className="flex h-9 w-9 sm:h-10 sm:px-3 sm:w-auto items-center justify-center gap-2 text-xs font-semibold rounded-xl border border-white/10 bg-white/[0.05] text-muted-foreground hover:text-foreground hover:bg-white/[0.1] hover:border-white/20 transition-all duration-200 active:scale-95 shadow-sm"
                    >
                      <Settings2 className="h-4 w-4 text-amber-400" />
                      <span className="hidden sm:inline whitespace-nowrap">Membres</span>
                    </button>
                  )}
                </div>
              </div>

              {/* MESSAGES THREAD — the scroll container itself must be a plain
                  overflow-y-auto box with no flex-direction/justify-content of
                  its own: combining those on the same element as the overflow
                  broke scrollHeight measurement on desktop (it kept reporting
                  scrollHeight === clientHeight no matter how much content
                  overflowed, so wheel/trackpad scroll silently did nothing —
                  the overflow spilled into the parent's own overflow-hidden
                  instead). The inner wrapper below carries the actual
                  flex-col/justify-end/gap ("pin short threads to the bottom,
                  WhatsApp-style") — decoupled from the element that scrolls. */}
              <div
                ref={messagesThreadRef}
                onScroll={handleThreadScroll}
                onClick={() => reactionPickerFor && closeMessageMenu()}
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-6 pt-4 pb-4 z-10 relative scroll-smooth"
              >
              <div className="min-h-full flex flex-col justify-end gap-3 md:gap-4">
                {loadingMessages && messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full space-y-4">
                    <Loader2 className="h-10 w-10 animate-spin text-amber-500/40" />
                    <p className="text-sm font-medium text-muted-foreground/40 animate-pulse">Chargement de vos messages...</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-6">
                    <div className="relative">
                      <div className="absolute inset-0 bg-amber-500/20 blur-2xl rounded-full" />
                      <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-black/40 border border-white/10 text-amber-400/80 shadow-2xl">
                        <MessageSquare className="h-10 w-10" />
                      </div>
                    </div>
                    <div className="space-y-2 max-w-[240px]">
                      <h3 className="text-lg font-bold text-foreground">C'est le début d'une histoire</h3>
                      <p className="text-sm text-muted-foreground/60 leading-relaxed">
                        Envoyez votre premier message pour démarrer la conversation dans <span className="text-amber-400/80 font-semibold">{activeGroupName}</span>.
                      </p>
                    </div>
                  </div>
                ) : (
                  messages.map((msg, idx) => {
                    const isMe = msg.senderId === user?.id;
                    const isAdminSender = msg.senderIsAdmin === 1;
                    const isDeleted = !!msg.deletedAt;
                    const isImage = !isDeleted && msg.content.startsWith("data:image/");
                    const emojiCount = !isImage && !isDeleted ? getEmojiOnlyCount(msg.content) : null;
                    const isEmojiMsg = emojiCount !== null;
                    const userColor = getUserColor(msg.senderUsername);
                    const pickerOpen = reactionPickerFor === msg.id;
                    const prevMsg = messages[idx - 1];
                    const nextMsg = messages[idx + 1];
                    const showDateSeparator = !prevMsg || !isSameDay(prevMsg.createdAt, msg.createdAt);
                    // Grouping only looks within the same sender run — a
                    // date separator always breaks a group even if the gap
                    // check alone wouldn't have.
                    const isGroupedWithPrev = !showDateSeparator && !isDeleted && isGroupedMessagePair(prevMsg, msg);
                    const isGroupedWithNext = !isDeleted && !nextMsg?.deletedAt && isGroupedMessagePair(msg, nextMsg);

                    return (
                      <Fragment key={msg.id}>
                        {showDateSeparator && (
                          <div className="flex items-center justify-center my-1 select-none">
                            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/50 bg-white/[0.04] border border-white/[0.06] rounded-full px-3 py-1">
                              {formatDateSeparator(msg.createdAt)}
                            </span>
                          </div>
                        )}
                        <div
                          ref={(el) => {
                            if (el) messageRefs.current.set(msg.id, el);
                            else messageRefs.current.delete(msg.id);
                          }}
                          onContextMenu={(e) => {
                            if (isDeleted || msg.pending) return;
                            e.preventDefault();
                            if (pickerOpen) closeMessageMenu(); else openMessageMenu(msg.id);
                          }}
                          onTouchStart={(e) => {
                            if (isDeleted || msg.pending) return;
                            startLongPress(msg.id);
                            handleSwipeTouchStart(e, msg.id);
                          }}
                          onTouchMove={(e) => {
                            longPressMovedRef.current = true;
                            cancelLongPress();
                            if (!isDeleted && !msg.pending) handleSwipeTouchMove(e, msg.id);
                          }}
                          onTouchEnd={(e) => {
                            cancelLongPress();
                            handleSwipeTouchEnd(msg.id, msg);
                            if (longPressFiredRef.current) {
                              e.preventDefault();
                              longPressFiredRef.current = false;
                            }
                          }}
                          onTouchCancel={() => {
                            cancelLongPress();
                            handleSwipeTouchEnd(msg.id, msg);
                            longPressFiredRef.current = false;
                          }}
                          className={cn(
                            "group flex flex-col max-w-[85%] sm:max-w-[75%] md:max-w-[65%] animate-in fade-in-50 duration-200 transition-opacity rounded-lg",
                            isMe ? "ml-auto items-end" : "mr-auto items-start",
                            msg.pending && "opacity-60",
                            // Consecutive same-sender messages sit closer
                            // together, Telegram-style — mobile only,
                            // desktop keeps its original even spacing.
                            isGroupedWithPrev && "-mt-2.5 sm:mt-0"
                          )}
                        >
                        {/* Sender labels — only on the first bubble of a
                            consecutive run from this sender */}
                        {!isActiveDirect && !isMe && !isGroupedWithPrev && (
                          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/50 mb-1 px-1 select-none">
                            <span className={cn("font-semibold", userColor.text)}>
                              {msg.senderUsername}
                            </span>
                            {isAdminSender && (
                              <span className="inline-flex items-center gap-0.5 text-[8.5px] font-bold px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/60 uppercase tracking-widest leading-none">
                                Admin
                              </span>
                            )}
                          </div>
                        )}

                        {/* Bubble row — react/action button sits on the inner side, revealed on hover (desktop) or long-press (mobile).
                            touchAction: pan-y lets the browser keep handling vertical scroll natively while a
                            horizontal drag (swipe-to-reply) is tracked manually in JS without the two fighting. */}
                        <div
                          ref={(el) => {
                            if (el) bubbleRowRefs.current.set(msg.id, el);
                            else bubbleRowRefs.current.delete(msg.id);
                          }}
                          style={{ touchAction: "pan-y" }}
                          className={cn("relative flex items-end gap-1", isMe ? "flex-row-reverse" : "flex-row")}
                        >
                          {/* Sender avatar, group chats only — reserved as a
                              spacer on every bubble in a run so they all line
                              up, but only actually drawn on the last bubble
                              of the run (bottom-anchored, Telegram-style).
                              Mobile only; desktop is untouched. */}
                          {!isActiveDirect && !isMe && (
                            <div className="md:hidden shrink-0 mb-0.5 h-6 w-6 rounded-full overflow-hidden">
                              {!isGroupedWithNext && (
                                msg.senderAvatar ? (
                                  <img src={msg.senderAvatar} alt={msg.senderUsername} className="h-full w-full object-cover" />
                                ) : (
                                  <div className={cn("h-full w-full flex items-center justify-center text-[9px] font-bold text-white bg-gradient-to-br", userColor.bg)}>
                                    {getInitial(msg.senderUsername)}
                                  </div>
                                )
                              )}
                            </div>
                          )}
                          {!isDeleted && !msg.pending && (
                            <div
                              ref={(el) => {
                                if (el) swipeIconRefs.current.set(msg.id, el);
                                else swipeIconRefs.current.delete(msg.id);
                              }}
                              style={{ opacity: 0 }}
                              className="absolute left-0 -translate-x-9 bottom-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-amber-400 pointer-events-none"
                            >
                              <Reply className="h-3.5 w-3.5" />
                            </div>
                          )}
                                  {isDeleted ? (
                                    <div
                                      className={cn(
                                        "flex items-center gap-1.5 italic rounded-2xl text-[13px] px-4 py-2.5 text-muted-foreground/50 border border-white/[0.06] bg-white/[0.02]",
                                        isMe ? "rounded-tr-none" : "rounded-tl-none"
                                      )}
                                    >
                                      <Ban className="h-3.5 w-3.5 shrink-0" />
                                      Message supprimé
                                    </div>
                                  ) : (
                                    <div className="relative group/msg">
                                      <div
                                        className={cn(
                                          isEmojiMsg
                                            ? cn(
                                                "select-none p-1",
                                                emojiCount === 1 && "text-5xl drop-shadow-lg",
                                                emojiCount === 2 && "text-4xl drop-shadow-md",
                                                emojiCount === 3 && "text-3xl drop-shadow-sm"
                                              )
                                            : cn(
                                                "rounded-[22px] text-[15px] leading-[1.4] relative shadow-lg transition-all duration-200",
                                                isImage ? "p-1 overflow-hidden" : "px-4 py-2.5 pb-6 min-w-[80px] max-w-full",
                                                isMe
                                                  ? "bg-gradient-to-br from-amber-400 via-amber-500 to-orange-600 text-black border border-amber-300/20 shadow-amber-500/10"
                                                  : "bg-white/[0.05] border border-white/[0.08] text-white/95 backdrop-blur-md shadow-black/20",
                                                // Smooth grouping logic
                                                isMe
                                                  ? (isGroupedWithNext ? "rounded-br-[6px]" : "rounded-br-[22px]")
                                                  : (isGroupedWithNext ? "rounded-bl-[6px]" : "rounded-bl-[22px]")
                                              )
                                        )}
                                      >
                                        {msg.replyToId && (
                                          <div
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              scrollToMessage(msg.replyToId!);
                                            }}
                                            className={cn(
                                              "mb-2 rounded-xl border-l-4 pl-3 pr-2 py-1.5 cursor-pointer text-[12.5px] max-w-full overflow-hidden",
                                              isMe ? "bg-black/20 border-white/40" : "bg-white/5 border-amber-500/60"
                                            )}
                                          >
                                            <div className={cn("font-bold truncate mb-0.5", isMe ? "text-white/90" : "text-amber-400")}>
                                              {msg.replyToSenderUsername ?? "Message"}
                                            </div>
                                            <div className={cn("truncate opacity-70 text-[11.5px]", isMe ? "text-white" : "text-muted-foreground")}>
                                              {msg.replyToContent === null
                                                ? "Message supprimé"
                                                : msg.replyToContent.startsWith("data:image/")
                                                  ? "📷 Photo"
                                                  : msg.replyToContent}
                                            </div>
                                          </div>
                                        )}
                                        
                                        {isImage ? (
                                          <img
                                            src={msg.content}
                                            alt="Image envoyée"
                                            draggable={false}
                                            className="max-w-full max-h-[300px] rounded-[16px] object-contain cursor-pointer hover:brightness-110 transition-all duration-200 select-none"
                                            style={{ WebkitTouchCallout: "none" }}
                                            onClick={() => {
                                              setReactionPickerFor(null);
                                              setShowEmojiPicker(false);
                                              setFullscreenImage(msg.content);
                                            }}
                                          />
                                        ) : (
                                          // select-none + touch-callout: none stop mobile Safari/Chrome from
                                          // treating a long-press as "select this text" (native selection
                                          // handles + Copy/Look Up bubble) — that native UI would otherwise
                                          // win the race against startLongPress() below and hijack the
                                          // gesture before our own reply/copy/react action menu can open.
                                          <div
                                            className="whitespace-pre-wrap break-words break-all max-w-full select-none"
                                            style={{ WebkitTouchCallout: "none" }}
                                          >
                                            {isEmojiMsg ? msg.content : formatMessageContent(msg.content)}
                                          </div>
                                        )}

                                        {/* Integrated Timestamp & Status */}
                                        {!isEmojiMsg && (
                                          <div className={cn(
                                            "absolute bottom-1.5 right-3.5 flex items-center gap-1 select-none pointer-events-none",
                                            isMe ? "text-black/50" : "text-white/30"
                                          )}>
                                            <span className="text-[10px] font-bold tabular-nums">
                                              {new Date(msg.createdAt * 1000).toLocaleTimeString("fr-FR", {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                              })}
                                            </span>
                                            {isMe && (
                                              <div className="flex items-center scale-75 origin-right">
                                                {msg.pending ? (
                                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : msg.readAt ? (
                                                  <CheckCheck className="h-3.5 w-3.5 text-black/70" />
                                                ) : msg.deliveredAt ? (
                                                  <CheckCheck className="h-3.5 w-3.5" />
                                                ) : (
                                                  <Check className="h-3.5 w-3.5" />
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                          {!msg.pending && !isDeleted && (
                            <button
                              type="button"
                              onClick={() => (pickerOpen ? closeMessageMenu() : openMessageMenu(msg.id))}
                              title="Réagir / Actions"
                              className={cn(
                                // Mobile: hidden — long-press opens the menu (WhatsApp).
                                // Desktop: hover-reveal next to the bubble.
                                "hidden sm:flex shrink-0 mb-0.5 h-7 w-7 items-center justify-center rounded-full text-muted-foreground/40 hover:text-amber-400 hover:bg-white/[0.06] transition-all duration-150 cursor-pointer",
                                pickerOpen ? "opacity-100 bg-white/[0.06] text-amber-400" : "opacity-0 group-hover/msg:opacity-100"
                              )}
                            >
                              <Smile className="h-4 w-4" />
                            </button>
                          )}

                          {pickerOpen && (
                            <div className="hidden md:block">
                              <div className="fixed inset-0 z-[100]" onClick={closeMessageMenu} />
                              <div
                                className={cn(
                                  "absolute bottom-full mb-1.5 z-[101] rounded-2xl border border-white/[0.08] bg-[oklch(0.16_0.03_250)] shadow-2xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden",
                                  isMe ? "right-0" : "left-0"
                                )}
                              >
                                <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-white/[0.06]">
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
                                <div className="flex flex-col p-1 min-w-[9.5rem]">
                                  <button
                                    type="button"
                                    onClick={() => startReplyMessage(msg)}
                                    className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-foreground/90 hover:bg-white/[0.06] transition-colors cursor-pointer"
                                  >
                                    <Reply className="h-3.5 w-3.5" /> Répondre
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openForwardModal(msg)}
                                    className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-foreground/90 hover:bg-white/[0.06] transition-colors cursor-pointer"
                                  >
                                    <Forward className="h-3.5 w-3.5" /> Transférer
                                  </button>
                                  {!isImage && (
                                    <button
                                      type="button"
                                      onClick={() => copyMessageText(msg.content)}
                                      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-foreground/90 hover:bg-white/[0.06] transition-colors cursor-pointer"
                                    >
                                      <Copy className="h-3.5 w-3.5" /> Copier
                                    </button>
                                  )}
                                  {isMe && !isImage && (
                                    <button
                                      type="button"
                                      onClick={() => startEditMessage(msg)}
                                      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-foreground/90 hover:bg-white/[0.06] transition-colors cursor-pointer"
                                    >
                                      <Pencil className="h-3.5 w-3.5" /> Modifier
                                    </button>
                                  )}
                                  {isMe && (
                                    <button
                                      type="button"
                                      onClick={() => deleteMessage(msg)}
                                      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" /> Supprimer
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Mobile — full-screen blurred context menu, Telegram-style.
                              Positioned with `fixed` from the bubble's captured on-screen
                              rect (contextMenuAnchor) so it always lands next to the
                              message regardless of scroll, and is never clipped by the
                              thread's overflow-y-auto (fixed positioning escapes that). */}
                          {pickerOpen && contextMenuAnchor && (
                            <div className="md:hidden">
                              <div
                                className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
                                onClick={closeMessageMenu}
                              />
                              <div
                                className={cn(
                                  "fixed z-[201] w-[min(18rem,calc(100vw-2rem))] rounded-[26px] border border-white/[0.06] bg-black/40 backdrop-blur-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden",
                                  isMe ? "origin-top-right" : "origin-top-left"
                                )}
                                style={getMobileContextMenuStyle(contextMenuAnchor, isMe)}
                              >
                                <div className="flex items-center justify-between gap-0.5 px-2 py-2.5 border-b border-white/[0.06]">
                                  {QUICK_REACTIONS.map((emoji) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      onClick={() => { toggleReaction(msg.id, emoji); closeMessageMenu(); }}
                                      className="flex h-10 w-10 items-center justify-center text-2xl rounded-full hover:bg-white/[0.08] active:scale-90 transition-all duration-100 cursor-pointer"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    title="Plus de réactions"
                                    onClick={() => setReactionEmojiPickerFor(msg.id)}
                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-white/[0.08] active:scale-90 transition-all duration-100 cursor-pointer text-muted-foreground"
                                  >
                                    <Plus className="h-5 w-5" />
                                  </button>
                                </div>
                                <div className="flex flex-col p-1.5">
                                  <button
                                    type="button"
                                    onClick={() => { startReplyMessage(msg); closeMessageMenu(); }}
                                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-foreground/90 hover:bg-white/[0.06] active:bg-white/[0.08] transition-colors cursor-pointer"
                                  >
                                    <Reply className="h-4.5 w-4.5 text-blue-400" /> Répondre
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { openForwardModal(msg); closeMessageMenu(); }}
                                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-foreground/90 hover:bg-white/[0.06] active:bg-white/[0.08] transition-colors cursor-pointer"
                                  >
                                    <Forward className="h-4.5 w-4.5 text-indigo-400" /> Transférer
                                  </button>
                                  {!isImage && (
                                    <button
                                      type="button"
                                      onClick={() => { copyMessageText(msg.content); closeMessageMenu(); }}
                                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-foreground/90 hover:bg-white/[0.06] active:bg-white/[0.08] transition-colors cursor-pointer"
                                    >
                                      <Copy className="h-4.5 w-4.5 text-emerald-400" /> Copier
                                    </button>
                                  )}
                                  {isMe && !isImage && (
                                    <button
                                      type="button"
                                      onClick={() => { startEditMessage(msg); closeMessageMenu(); }}
                                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-foreground/90 hover:bg-white/[0.06] active:bg-white/[0.08] transition-colors cursor-pointer"
                                    >
                                      <Pencil className="h-4.5 w-4.5 text-amber-400" /> Modifier
                                    </button>
                                  )}
                                  {isMe && (
                                    <button
                                      type="button"
                                      onClick={() => { deleteMessage(msg); closeMessageMenu(); }}
                                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-red-400 hover:bg-red-500/10 active:bg-red-500/15 transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="h-4.5 w-4.5 text-rose-400" /> Supprimer
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Full emoji grid for reacting — opened from the "+" above,
                              reuses EMOJI_CATEGORIES (same data as the composer picker). */}
                          {reactionEmojiPickerFor === msg.id && (
                            <div className="md:hidden">
                              <div
                                className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-md animate-in fade-in duration-150"
                                onClick={() => setReactionEmojiPickerFor(null)}
                              />
                              <div className="fixed inset-x-4 bottom-8 z-[211] bg-[oklch(0.16_0.03_250)] border border-white/[0.08] rounded-[26px] shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
                                <div className="flex items-center gap-1 p-2 border-b border-white/[0.06] overflow-x-auto scrollbar-none">
                                  {EMOJI_CATEGORIES.map((cat, idx) => (
                                    <button
                                      key={cat.name}
                                      type="button"
                                      onClick={() => setReactionEmojiCategory(idx)}
                                      title={cat.name}
                                      className={cn(
                                        "flex h-9 w-9 shrink-0 items-center justify-center text-[16px] rounded-xl transition-all duration-150 cursor-pointer",
                                        idx === reactionEmojiCategory
                                          ? "bg-amber-500/15 border border-amber-500/25"
                                          : "hover:bg-white/[0.06] border border-transparent"
                                      )}
                                    >
                                      {cat.icon}
                                    </button>
                                  ))}
                                </div>
                                <div className="grid grid-cols-6 gap-1 p-2.5 max-h-64 overflow-y-auto">
                                  {EMOJI_CATEGORIES[reactionEmojiCategory].emojis.map((emoji, idx) => (
                                    <button
                                      key={`${emoji}-${idx}`}
                                      type="button"
                                      onClick={() => { toggleReaction(msg.id, emoji); setReactionEmojiPickerFor(null); closeMessageMenu(); }}
                                      className="flex h-9 w-9 items-center justify-center text-[18px] rounded-xl hover:bg-white/[0.06] active:bg-white/[0.1] active:scale-95 transition-all duration-100 cursor-pointer"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Reaction pills */}
                        {!isDeleted && msg.reactions.length > 0 && (
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

                        {/* Msg timestamp and read receipt - Hidden if inside bubble */}
                        {isDeleted && (
                          <div className="flex items-center gap-1.5 mt-1.5 px-1 select-none">
                            <span className="text-[9px] text-muted-foreground/35">
                              {new Date(msg.createdAt * 1000).toLocaleTimeString("fr-FR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        )}
                        </div>
                      </Fragment>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
              </div>

              {/* FLOATING SCROLL BOTTOM BUTTON */}
              {showScrollBottom && (
                <button
                  onClick={() => scrollToBottom(false)}
                  className="absolute bottom-24 right-4 sm:right-8 z-30 h-11 w-11 flex items-center justify-center rounded-full bg-white/5 backdrop-blur-xl text-amber-400 shadow-2xl border border-white/10 hover:scale-110 active:scale-90 transition-all animate-in zoom-in fade-in duration-300 cursor-pointer group/scroll"
                  title="Aller aux derniers messages"
                >
                  <ChevronRight className="h-5 w-5 rotate-90 transition-transform group-hover/scroll:translate-y-0.5" />
                  <div className="absolute inset-0 rounded-full bg-amber-500/10 blur-md opacity-0 group-hover/scroll:opacity-100 transition-opacity" />
                </button>
              )}

              {/* INPUT BAR — mobile: floating premium glass bar */}
              <div className={cn(
                "shrink-0 relative z-[110]",
                "px-2.5 pb-[env(safe-area-inset-bottom)] md:px-6 md:pb-6 pt-2",
                "bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/80 to-transparent",
                keyboardOpen && "pb-2"
              )}>
                <div className="max-w-[1000px] mx-auto">
                  {showEmojiPicker && (
                    <>
                      <div
                        className="fixed inset-0 z-[100]"
                        onClick={() => setShowEmojiPicker(false)}
                      />
                      <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-[101] bg-[#141416]/95 backdrop-blur-xl border border-white/[0.1] rounded-[24px] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] w-[calc(100vw-1.5rem)] max-w-[400px] animate-in fade-in slide-in-from-bottom-4 duration-200 overflow-hidden">
                        <div className="flex items-center gap-1 p-2.5 border-b border-white/[0.06] overflow-x-auto scrollbar-none">
                          {EMOJI_CATEGORIES.map((cat, idx) => (
                            <button
                              key={cat.name}
                              type="button"
                              onClick={() => setActiveEmojiCategory(idx)}
                              title={cat.name}
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center text-[16px] rounded-xl transition-all duration-150 cursor-pointer",
                                idx === activeEmojiCategory
                                  ? "bg-amber-500/20 border border-amber-500/40 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.2)]"
                                  : "hover:bg-white/[0.06] border border-transparent text-white/40"
                              )}
                            >
                              {cat.icon}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-6 gap-1.5 p-3 max-h-56 overflow-y-auto">
                          {EMOJI_CATEGORIES[activeEmojiCategory].emojis.map((emoji, idx) => (
                            <button
                              key={`${emoji}-${idx}`}
                              type="button"
                              onClick={() => handleSelectEmoji(emoji)}
                              className="flex h-10 w-10 items-center justify-center text-[20px] rounded-xl hover:bg-white/[0.08] active:bg-amber-500/20 active:scale-90 transition-all duration-100 cursor-pointer"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {replyingTo && (
                    <div className="relative mx-1 px-3.5 py-2.5 mb-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md flex items-center gap-3 shrink-0 shadow-lg animate-in slide-in-from-bottom-2 duration-200">
                      <div className="absolute left-0 top-2 bottom-2 w-1 bg-amber-500 rounded-full" />
                      <Reply className="h-4 w-4 text-amber-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-black text-amber-500 uppercase tracking-widest leading-none mb-1">
                          Réponse à {replyingTo.senderId === user?.id ? "Moi" : replyingTo.senderUsername}
                        </div>
                        <div className="text-[13px] text-white/60 truncate leading-tight">
                          {replyingTo.content.startsWith("data:image/") ? "📷 Photo" : replyingTo.content}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={cancelReply}
                        className="h-7 w-7 flex items-center justify-center rounded-full text-white/30 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {editingMessage && (
                    <div className="relative mx-1 px-3.5 py-2.5 mb-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md flex items-center gap-3 shrink-0 shadow-lg animate-in slide-in-from-bottom-2 duration-200">
                      <div className="absolute left-0 top-2 bottom-2 w-1 bg-amber-500 rounded-full" />
                      <Pencil className="h-4 w-4 text-amber-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-black text-amber-500 uppercase tracking-widest leading-none mb-1">Modification</div>
                        <div className="text-[13px] text-white/60 truncate leading-tight">{editingMessage.content}</div>
                      </div>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="h-7 w-7 flex items-center justify-center rounded-full text-white/30 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* Composer row — Floating bar */}
                  <div className="flex items-end gap-2.5">
                    <div className={cn(
                      "flex flex-1 min-w-0 items-end",
                      "rounded-[26px] md:rounded-[28px]",
                      "border border-white/[0.12]",
                      "bg-white/[0.04] backdrop-blur-xl shadow-2xl",
                      "p-1.5 transition-all duration-300 ease-out",
                      "focus-within:border-amber-500/40 focus-within:bg-white/[0.06] focus-within:shadow-amber-500/5"
                    )}>
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200 cursor-pointer active:scale-90",
                          showEmojiPicker ? "text-amber-400 bg-amber-400/10" : "text-white/30 hover:text-white/60"
                        )}
                      >
                        <Smile className="h-5.5 w-5.5" strokeWidth={2} />
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
                            const isMobile = window.matchMedia("(max-width: 767px)").matches;
                            if (isMobile) return;
                            e.preventDefault();
                            handleSendMessage(e);
                          }
                        }}
                        placeholder="Votre message..."
                        className="flex-1 min-w-0 self-center bg-transparent border-none text-[16px] md:text-[15px] text-white placeholder:text-white/20 focus:outline-none focus:ring-0 resize-none max-h-[10rem] overflow-y-auto leading-[1.4] py-2 px-1 tracking-tight caret-amber-400"
                      />

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/30 hover:text-white/60 transition-all duration-200 cursor-pointer active:scale-90"
                      >
                        <Paperclip className="h-5 w-5" strokeWidth={2} />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => (inputText.trim() || selectedImage) && handleSendMessage(e)}
                      disabled={sending || (!inputText.trim() && !selectedImage)}
                      className={cn(
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-all duration-300 cursor-pointer active:scale-90",
                        (inputText.trim() || selectedImage)
                          ? "bg-gradient-to-br from-amber-400 to-orange-600 text-black shadow-[0_4px_20px_-4px_rgba(245,158,11,0.5)] border border-amber-300/30"
                          : "bg-white/[0.03] text-white/10 border border-white/[0.05] cursor-not-allowed"
                      )}
                    >
                      {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 fill-current translate-x-[1px]" />}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-8 relative overflow-hidden">
              {/* Subtle background flare */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-amber-500/[0.03] rounded-full blur-[100px]" />
              
              <div className="relative">
                <div className="absolute inset-0 bg-white/5 blur-3xl rounded-full scale-150" />
                <div className="relative flex h-28 w-28 items-center justify-center rounded-[40px] bg-gradient-to-br from-white/[0.05] to-transparent border border-white/10 text-muted-foreground/30 shadow-2xl transition-transform duration-500 hover:rotate-12">
                  <MessageSquare className="h-12 w-12" />
                </div>
              </div>
              
              <div className="relative space-y-3 max-w-[320px]">
                <h3 className="text-xl font-bold text-foreground tracking-tight">Votre messagerie Au Pluriel</h3>
                <p className="text-sm text-muted-foreground/50 leading-relaxed">
                  Connectez-vous avec vos partenaires et votre équipe. Sélectionnez une discussion dans la liste de gauche pour commencer.
                </p>
              </div>

              <div className="flex items-center gap-6 pt-4 text-muted-foreground/20">
                <div className="flex flex-col items-center gap-1.5">
                  <Users className="h-5 w-5" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Groupes</span>
                </div>
                <div className="h-8 w-px bg-white/[0.05]" />
                <div className="flex flex-col items-center gap-1.5">
                  <Shield className="h-5 w-5" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Sécurisé</span>
                </div>
                <div className="h-8 w-px bg-white/[0.05]" />
                <div className="flex flex-col items-center gap-1.5">
                  <Bell className="h-5 w-5" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Direct</span>
                </div>
              </div>
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
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4.5 py-3 text-[16px] sm:text-sm text-foreground focus:border-amber-500/40 outline-none transition-all duration-150"
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

      {/* FORWARD MESSAGE MODAL */}
      {forwardingMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-white/[0.08] bg-[oklch(0.15_0.03_250)] p-5 sm:p-6 shadow-2xl space-y-5 sm:space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-inner">
                <Forward className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-foreground font-sans">Transférer le message</h3>
                <p className="text-xs text-muted-foreground truncate">
                  {forwardingMessage.content.startsWith("data:image/") ? "📷 Photo" : forwardingMessage.content}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="border border-white/[0.08] bg-white/[0.02] rounded-xl max-h-60 overflow-y-auto p-2.5 space-y-1 select-none">
                {groups.length === 0 ? (
                  <div className="text-[12px] text-muted-foreground/50 italic p-2 text-center">
                    Aucune conversation disponible
                  </div>
                ) : (
                  groups.map((g) => (
                    <label
                      key={g.id}
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-all duration-150"
                    >
                      <input
                        type="radio"
                        name="forward-target"
                        checked={forwardTargetId === g.id}
                        onChange={() => setForwardTargetId(g.id)}
                        className="border-white/20 bg-transparent text-amber-500 focus:ring-0 focus:ring-offset-0 h-4 w-4 cursor-pointer"
                      />
                      <span className="font-medium text-[13px]">
                        {g.isDirect === 1 ? `${g.name} (Privé)` : g.name}
                      </span>
                    </label>
                  ))
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setForwardingMessage(null);
                    setForwardTargetId(null);
                  }}
                  className="px-4 py-2.5 text-xs font-semibold rounded-xl border border-white/10 hover:bg-white/5 text-muted-foreground transition-all duration-200 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={confirmForward}
                  disabled={!forwardTargetId || forwarding}
                  className="flex items-center gap-1.5 px-4.5 py-2.5 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black transition-all duration-200 cursor-pointer"
                >
                  {forwarding ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-black" />
                      Envoi…
                    </>
                  ) : (
                    "Transférer"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN IMAGE LIGHTBOX (WhatsApp style with Zoom) */}
      {fullscreenImage && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl p-0 sm:p-4 animate-in fade-in duration-300 select-none"
          style={{
            opacity: lightboxDragY > 0 && lightboxScale === 1 ? Math.max(0.25, 1 - lightboxDragY / 300) : 1,
            transition: lightboxDragging ? "none" : "opacity 300ms, backdrop-blur 300ms",
          }}
          onClick={() => {
            if (lightboxScale === 1) setFullscreenImage(null);
          }}
        >
          {/* Header Controls */}
          <div 
            className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-4 bg-gradient-to-b from-black/60 to-transparent"
            style={{ paddingTop: "calc(1rem + env(safe-area-inset-top))" }}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFullscreenImage(null);
                }}
                className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-all cursor-pointer backdrop-blur-md"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (lightboxScale > 1) {
                    setLightboxScale(1);
                    setLightboxOffset({ x: 0, y: 0 });
                  } else {
                    setLightboxScale(2.5);
                  }
                }}
                className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-all cursor-pointer backdrop-blur-md"
                title={lightboxScale > 1 ? "Dézoomer" : "Zoomer"}
              >
                {lightboxScale > 1 ? <Square className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFullscreenImage(null);
                }}
                className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-all cursor-pointer backdrop-blur-md"
                title="Fermer"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
          </div>

          {/* Fullscreen Image container — drag down to dismiss (if not zoomed) or pan (if zoomed) */}
          <div
            className={cn(
              "relative w-full h-full flex items-center justify-center overflow-hidden touch-none",
              lightboxScale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default"
            )}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleLightboxTouchStart}
            onTouchMove={handleLightboxTouchMove}
            onTouchEnd={handleLightboxTouchEnd}
            onTouchCancel={handleLightboxTouchEnd}
          >
            <img
              src={fullscreenImage}
              alt="Aperçu plein écran"
              draggable={false}
              className="max-w-full max-h-full object-contain shadow-2xl transition-transform duration-300 ease-out will-change-transform"
              style={{
                transform: lightboxScale > 1 
                  ? `translate(${lightboxOffset.x}px, ${lightboxOffset.y}px) scale(${lightboxScale})`
                  : `translateY(${lightboxDragY}px) scale(1)`,
                transition: lightboxDragging ? "none" : "transform 300ms cubic-bezier(0.2, 0, 0, 1)",
              }}
            />
          </div>

          {/* Zoom hint for users */}
          {lightboxScale === 1 && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white/60 text-xs font-medium animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500 pointer-events-none">
              Double-tapez pour zoomer
            </div>
          )}
        </div>
      )}
    </div>
  );
}
