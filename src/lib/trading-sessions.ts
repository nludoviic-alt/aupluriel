/** Lightweight market-session helpers with no indicator or execution dependencies. */
export type TradingSession = "sydney" | "asia" | "london" | "newyork";

export const SESSION_HOURS: Record<TradingSession, { label: string; open: number; close: number }> = {
  sydney: { label: "Sydney", open: 21, close: 6 },
  asia: { label: "Asie", open: 0, close: 9 },
  london: { label: "Londres", open: 7, close: 16 },
  newyork: { label: "New York", open: 12, close: 21 },
};

/** Whether the UTC session window is open now, including windows crossing midnight. */
export function isSessionActive(session: TradingSession, edgeMinutes = 0): boolean {
  const now = new Date();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const { open, close } = SESSION_HOURS[session];
  const start = open * 60 + edgeMinutes;
  const end = close * 60 - edgeMinutes;
  return open > close ? utcMins >= start || utcMins < end : utcMins >= start && utcMins < end;
}

export function currentActiveSessions(): TradingSession[] {
  return (Object.keys(SESSION_HOURS) as TradingSession[]).filter((session) => isSessionActive(session));
}
