---
name: execution-safety-auditor
description: Audits execution safety, WebSocket connection resilience, order placement safeguards, stale tick detection, heartbeat monitoring, and Deriv API failure isolation. Use when verifying execution reliability, error recovery, or network disconnect safeguards.
---

# Execution Safety Auditor

An execution-layer security and reliability pass ensuring zero orphaned orders, zero unhandled WebSocket disconnections, and full recovery under high latency or network drops.

## Execution Safety Checklist

### 1. WebSocket Connection & Heartbeat Resilience
- Confirm `DerivTradingConnection` automatically detects drops and reconnects within 15 seconds.
- Verify `HeartbeatMonitor` (`alerting.server.ts`) records tick activity and alerts when tick processing stalls.
- Ensure authentication tokens are safely managed and renewed on reconnect without exposing API keys in client logs.

### 2. Orphaned Contract Prevention
- Confirm that stopping a bot loop waits until all open contracts (`status = 'open'`) are settled or force-closed.
- Verify contract resolution callbacks (`proposal_open_contract`) update `bot_trades` status atomically in SQLite.

### 3. Rate-Limiting & API Error Handling
- Check Deriv API rate limit handling (`RateLimitError`, `InvalidContractProposal`).
- Confirm signal rejections are logged into `signal_rejections` with exact diagnostic failure reasons.

### 4. Order Execution Idempotency
- Ensure order proposal requests use unique proposal/contract identifiers (`id` primary key collision check).
- Verify double-execution is impossible even if multiple tick events fire simultaneously.
