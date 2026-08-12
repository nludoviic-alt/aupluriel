---
name: production-readiness-auditor
description: Audits production deployment readiness — verifies database migrations, environment variable security, error logging, graceful shutdowns, performance reviews, and fail-safe rollbacks. Use before releasing new builds or pushing updates to production environments.
---

# Production Readiness Auditor

The final pre-flight checklist and release audit ensuring the trading application is fully hardened, observable, and ready for production deployment.

## Production Readiness Checklist

### 1. Database & Migration Hardening
- Verify all SQLite schema migrations in `db.server.ts` use idempotent `IF NOT EXISTS` and PRAGMA column checks.
- Confirm index coverage for high-frequency queries (`idx_bot_trades_user_preset_time`, `idx_config_versions_lookup`, `idx_perf_reviews_lookup`).

### 2. Environment & Security Audit
- Ensure no secret keys, API tokens, or passwords are hardcoded in source files.
- Confirm production environment variables (`DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `DERIV_APP_ID`) are properly loaded.

### 3. Observability & Rollback Guardrails
- Confirm `ConfigRegistry` is active and strategy versioning is tracking all parameter edits.
- Verify `AlertingEngine` and `HeartbeatMonitor` are operational for real-time failure notification.
- Test 1-click rollback functionality via `/api/admin/config-registry`.

### 4. Build & Runtime Sanity
- Confirm `npm run build` compiles without errors.
- Ensure dev/production server processes shut down gracefully without dangling WebSocket connections or unhandled promise rejections.
