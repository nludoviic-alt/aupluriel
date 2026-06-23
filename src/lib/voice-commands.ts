// Maps spoken French phrases to app routes and actions.

export interface VoiceRoute {
  to: string;
  keywords: string[];
  label: string;
}

export const VOICE_ROUTES: VoiceRoute[] = [
  { to: "/", keywords: ["dashboard", "accueil", "tableau de bord", "page principale"], label: "Dashboard" },
  { to: "/portfolio", keywords: ["portfolio", "portefeuille", "mes positions", "positions"], label: "Portfolio" },
  { to: "/signals", keywords: ["signaux", "signal", "ia signals", "signaux ia"], label: "Signaux" },
  { to: "/autotrader", keywords: ["auto trader", "autotrader", "trading automatique", "robot", "bot"], label: "Auto-Trader" },
  { to: "/backtest", keywords: ["backtest", "back test", "test historique"], label: "Backtest" },
  { to: "/markets", keywords: ["marché", "marchés", "marche", "graphique", "graphiques", "cours"], label: "Marchés" },
  { to: "/strategies", keywords: ["stratégie", "stratégies", "strategie", "strategies"], label: "Stratégies" },
  { to: "/alerts", keywords: ["alerte", "alertes", "notification", "notifications"], label: "Alertes" },
  { to: "/settings", keywords: ["paramètre", "paramètres", "réglage", "réglages", "configuration", "settings"], label: "Paramètres" },
];

export type VoiceActionType =
  | "navigate"
  | "start-bot"
  | "stop-bot"
  | "new-chat"
  | "refresh"
  | "unknown";

export interface VoiceCommand {
  type: VoiceActionType;
  route?: string;
  label?: string;
  raw: string;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .trim();
}

const NAV_TRIGGERS = ["va", "vas", "ouvre", "ouvrir", "affiche", "montre", "aller", "page", "navigue", "ouvrez"];
const START_TRIGGERS = ["démarre", "demarre", "lance", "lancer", "active", "active le bot", "start"];
const STOP_TRIGGERS = ["arrête", "arrete", "stop", "stoppe", "désactive", "desactive", "coupe"];

export function parseVoiceCommand(transcript: string): VoiceCommand {
  const raw = transcript;
  const text = normalize(transcript);

  // Start / stop the auto-trader
  const isBotContext = text.includes("bot") || text.includes("trader") || text.includes("robot") || text.includes("trading");
  if (STOP_TRIGGERS.some((t) => text.includes(normalize(t))) && (isBotContext || text.split(" ").length <= 2)) {
    return { type: "stop-bot", raw };
  }
  if (START_TRIGGERS.some((t) => text.includes(normalize(t))) && isBotContext) {
    return { type: "start-bot", raw };
  }

  // New chat
  if ((text.includes("nouvelle") && text.includes("conversation")) || text.includes("efface le chat") || text.includes("reset chat")) {
    return { type: "new-chat", raw };
  }

  // Refresh
  if (text.includes("actualise") || text.includes("rafraichis") || text.includes("rafraîchis") || text.includes("recharge")) {
    return { type: "refresh", raw };
  }

  // Navigation — find best route match
  let best: { route: VoiceRoute; score: number } | null = null;
  for (const route of VOICE_ROUTES) {
    for (const kw of route.keywords) {
      const nkw = normalize(kw);
      if (text.includes(nkw)) {
        const score = nkw.length; // longer match = more specific
        if (!best || score > best.score) best = { route, score };
      }
    }
  }

  if (best) {
    const hasNavTrigger = NAV_TRIGGERS.some((t) => text.includes(normalize(t)));
    // Accept either an explicit nav verb OR a bare section name
    if (hasNavTrigger || text.split(" ").length <= 3) {
      return { type: "navigate", route: best.route.to, label: best.route.label, raw };
    }
  }

  return { type: "unknown", raw };
}
