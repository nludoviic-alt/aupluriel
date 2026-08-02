---
name: production-trading-guardian
description: Safety procedure for deploying a change that touches the trading engine — backs up the database, snapshots active configs before the change, verifies the build, and after deploy confirms bots actually resumed, checks for new errors, and compares performance on the next 20/50/100 trades against the pre-deploy baseline. Use before and after any deploy that touches src/lib/bot-engine.server.ts, src/lib/signal-core.ts, src/lib/autotrader.ts, or the DB schema — not for routine UI-only changes.
---

# Production trading guardian

This is a procedure, not an autonomous script. The steps that touch
production (backup, deploy, restart, rollback) need a human with actual VPS
access at the keyboard for each one — an agent should never SSH in and
restart a service that's holding open trading positions without a human
confirming first. What IS automated here is everything safe to check
locally, before that human steps in.

## Before touching production

1. Run the local pre-flight check:

```bash
bash .agents/skills/production-trading-guardian/scripts/preflight.sh
```

This confirms: what's uncommitted (`git status`/`git diff --name-only`), that
the production build actually succeeds (`npm run build` — catches type errors
the dev server's HMR can silently tolerate), and scans
`src/lib/db.server.ts` for any `CREATE TABLE` missing `IF NOT EXISTS` or
`ADD COLUMN` not obviously guarded by a column-existence check — a
non-idempotent migration is the single most common way a redeploy corrupts
or crashes against an already-populated production database.

2. If the change touches `BOOM_PRESET`/`CRASH_PRESET`/`DEFAULT_CONFIG` risk
   fields, confirm it was validated by `tune-boom-preset`/`tune-crash-preset`/
   `tune-multi-preset` first — don't deploy a parameter guess.
3. Snapshot the CURRENT baseline before deploying, so "did this help" has
   something to compare against:

```bash
node .agents/skills/audit-trading-production/scripts/audit-production.mjs /home/ubuntu/data/lio23.db --json > /tmp/pre-deploy-baseline.json
```

(Run this ON the VPS via SSH — the script needs the production DB file. Keep
the output; step 6 below diffs against it.)

## Deploying (human-executed, one step at a time)

4. Back up the production database BEFORE deploying:
   `cp /home/ubuntu/data/lio23.db /home/ubuntu/data/lio23.db.backup-$(date +%Y%m%d-%H%M%S)`
5. Deploy only the files this change actually touches (`git diff --name-only`
   from step 1 is the list) — this project's deploy target is Railway (see
   the comment in `src/routes/api/health.ts`); use whatever this project's
   established deploy command is, don't invent one.
6. Confirm the service restarted: hit `/api/health` — its own comment
   explains why this specific request matters here, not just "is it up":
   Railway's health-check ping is what triggers `src/server.ts`'s boot hook
   to restore previously-enabled bots. Nitro otherwise lazy-loads user code
   on the FIRST real request, so a restart with zero traffic can leave the
   auto-trader dormant until someone happens to visit the site.
7. Confirm the bots actually resumed — check the server log for
   `[bot] N bot(s) restauré(s) après redémarrage` (see
   `restoreEnabledBots`/similar in `bot-engine.server.ts`) and cross-check
   against `/api/admin/bot` that the SAME set of presets that were `enabled`
   before the restart still show `enabled + running` now.
8. Check `/api/admin/health` for anything newly `error`/`warn` in
   `health_status` that wasn't there before.
9. For any preset that was mid-trade at deploy time, confirm no position was
   orphaned: cross-check `bot_trades` rows with `status IN ('open','pending')`
   against what Deriv/the broker actually shows open — `stop()` on an engine
   tears down every subscription, so an open position that wasn't tracked
   through the restart stops receiving P&L updates and its `maxHoldMinutes`
   force-close silently never fires.

## After deploy — did it actually help?

10. Let real trades accumulate. Then compare, in this order of preference:
    - `config-change-impact` if this deploy corresponds to a logged
      `config_changes` row (config edits, not code-only changes, get logged
      automatically — see that skill).
    - Otherwise, re-run `audit-trading-production` and diff its output
      against the `/tmp/pre-deploy-baseline.json` from step 3, focused on the
      preset(s) this change touched.
    - Check at 20, 50, AND 100 new trades, not just once — a result at 20
      trades is exploratory (same `--min-sample` convention as the other
      audit skills), not a verdict.
11. If profit factor or expectancy visibly degrades with an adequate sample,
    treat it as a signal to roll back, not something to wait out:
    - Restore the DB backup from step 4 if the schema changed in a way the
      old code can't read.
    - Redeploy the previous commit.
    - Re-run steps 6-9 exactly the same way after the rollback — a rollback
      that doesn't restart cleanly is worse than the regression it was meant
      to fix.

**Note the scope split:** step 11 above is for a CODE deploy (preset defaults,
schema, engine logic) — it always needs a human to redeploy. A pure CONFIG
edit on one user's preset (stake, limits, confidence, TP/SL, symbols) already
has an automatic version of this same logic running server-side:
`config-rollback-guardian.server.ts` watches every logged `config_changes`
row and reverts it on its own once the degradation is confirmed (PF < 1,
≥20 trades both sides) — but ONLY for presets that opted in via
`autoRollbackEnabled` (off by default, toggled per preset in the admin user
profile). It never touches code or the database schema, only that one
preset's saved fields, so it doesn't replace this procedure for an actual
deploy — the two operate at different layers.

## Rules

- Never skip the pre-deploy backup, even for a change that "should" be
  read-only — the cost of being wrong about that is unbounded, the cost of a
  backup is one file copy.
- Never restart a production service or run a deploy command from an agent
  session without a human explicitly confirming that specific action —
  reference this SKILL.md's steps, don't auto-execute them.
- A rollback is not a failure to hide — report it plainly, with the numbers
  that triggered it.
