// Haptic feedback for app-like navigation feel on mobile.
//
// Uses the Vibration API: supported on Android (Chrome/Edge/Samsung Internet),
// silently unavailable on iOS — Safari exposes no vibration to web content at
// all (Apple platform limitation), so calls no-op there.
//
// Browsers gate vibrate() behind user activation: calls from tap/click
// handlers always work; async calls (e.g. a trade closing) work once the user
// has interacted with the page at least once, which is always true while the
// app is actually being used.

export type HapticKind = "light" | "medium" | "heavy" | "success" | "error";

const PATTERNS: Record<HapticKind, number | number[]> = {
  light: 10,               // nav taps, list selections
  medium: 20,              // toggles, confirmations
  heavy: 35,               // power button, destructive actions
  success: [15, 60, 30],   // trade won
  error: [40, 70, 40],     // trade lost / action failed
};

export function haptic(kind: HapticKind = "light"): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(PATTERNS[kind]);
    }
  } catch {
    /* never let feedback break the action itself */
  }
}
