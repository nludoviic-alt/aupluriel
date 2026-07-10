// Simple in-memory sliding-window rate limiter for public, unauthenticated
// endpoints (register/login/forgot-password/resend-verification) — the ones
// spam bots and brute-force scripts actually hit. The app runs as a single
// Node process on one VPS (see DEPLOY.md), so in-memory state is enough; no
// Redis needed, and a limiter reset on deploy/restart is an acceptable
// trade-off for this scale.

interface Bucket {
  hits: number[]; // epoch ms of each hit still inside the window
}

const buckets = new Map<string, Bucket>();

// Lazily-triggered cleanup so we never need a background timer (which would
// only add another thing to drain on SIGTERM). Runs at most once/minute.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < 60 * 60_000); // drop anything older than the widest window we use (1h)
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

/**
 * Records a hit for `key` and reports whether it's within `limit` hits per
 * `windowMs`. Call once per incoming request, before doing any real work.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const retryAfterMs = windowMs - (now - bucket.hits[0]);
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  bucket.hits.push(now);
  return { allowed: true, retryAfterMs: 0 };
}

/** Best-effort client IP behind the nginx reverse proxy (see DEPLOY.md). */
export function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** Standard 429 response with a Retry-After header, for consistent handling across endpoints. */
export function rateLimitResponse(retryAfterMs: number): Response {
  return new Response(
    JSON.stringify({ error: "Trop de tentatives. Réessaie dans quelques minutes." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
      },
    },
  );
}
