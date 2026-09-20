// Univers et calendrier de l'effet lundi (piste A) — partagé entre le scheduler
// serveur, l'API et l'interface. Module pur : aucune dépendance serveur.
//
// Depuis le 2026-09-20 l'univers est réduit aux deux indices US, seuls à ressortir
// nettement sur 26 ans de données quotidiennes (Nasdaq 100 : +0,18 %/lundi net,
// t = 2,9 sur 2020-2026 ; S&P 500 : +0,087 %) — voir la mémoire idx-seasonal.
//
// Exécution : compte Deriv MT5 démo, en semi-manuel. Le trade est intraday (clôturé
// avant le passage du swap, ~20:59 GMT) : ni swap ni frais d'administration ; spread
// de l'ordre de 0,4 bps. Le registre papier du serveur reste la référence théorique.

export interface IdxLeg {
  /** Symbole Deriv OTC utilisé pour le prix du registre papier. */
  symbol: string;
  /** Nom du symbole dans le terminal MT5 Deriv. */
  mt5Name: string;
  label: string;
  entryHourUtc: number;
  durationMin: number;
}

export const IDX_UNIVERSE: readonly IdxLeg[] = [
  { symbol: "OTC_SPC", mt5Name: "US SP 500", label: "S&P 500", entryHourUtc: 14, durationMin: 300 },
  { symbol: "OTC_NDX", mt5Name: "US Tech 100", label: "Nasdaq 100", entryHourUtc: 14, durationMin: 300 },
];

/** Volume minimum MT5 (0,1 lot) : ordre de grandeur d'une position de test. */
export const MT5_LOTS = 0.1;

/** Heure limite (GMT) avant laquelle clôturer : le swap passe à ~21:00 GMT (pause 20:59-22:01). */
export const MT5_ROLLOVER_HINT_GMT = "20:59";

export interface IdxPlanLeg extends IdxLeg {
  entryAtMs: number;
  exitAtMs: number;
}

export interface IdxMondayPlan {
  /** Date du lundi visé, YYYY-MM-DD (UTC). */
  mondayUtc: string;
  legs: IdxPlanLeg[];
}

/** Prochain lundi à jouer : aujourd'hui tant que la dernière sortie n'est pas passée, sinon lundi suivant. */
export function nextMondayPlan(now: Date = new Date()): IdxMondayPlan {
  const legsAt = (dayStartMs: number): IdxPlanLeg[] =>
    IDX_UNIVERSE.map((l) => {
      const entryAtMs = dayStartMs + l.entryHourUtc * 3600_000;
      return { ...l, entryAtMs, exitAtMs: entryAtMs + l.durationMin * 60_000 };
    });
  const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

  let start = dayStart(now);
  const dow = now.getUTCDay();
  const daysToMonday = (8 - dow) % 7; // 0 si lundi
  start += daysToMonday * 86_400_000;
  if (daysToMonday === 0) {
    const lastExit = Math.max(...legsAt(start).map((l) => l.exitAtMs));
    if (now.getTime() > lastExit) start += 7 * 86_400_000;
  }
  return { mondayUtc: new Date(start).toISOString().slice(0, 10), legs: legsAt(start) };
}
