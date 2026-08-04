import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a UTC hour (0-23, e.g. from SESSION_HOURS) as an "HH:MM" clock
 * time in Montreal (America/Montreal). Uses Intl's real DST rules instead of
 * a hardcoded UTC-4/-5 offset — Montreal switches between EDT and EST twice
 * a year on dates that don't line up with any fixed calendar rule simple
 * enough to hardcode correctly, and getting it wrong silently shifts every
 * session hour by 1h for part of the year.
 */
export function utcHourToMontreal(utcHour: number): string {
  const d = new Date();
  d.setUTCHours(utcHour, 0, 0, 0);
  return d.toLocaleTimeString("fr-CA", { timeZone: "America/Montreal", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once. Scanning many
 * symbols sequentially can turn a handful of network calls into a multi-minute
 * loop; unbounded Promise.all risks hammering a shared connection. This caps
 * concurrency without needing an external queue library.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
