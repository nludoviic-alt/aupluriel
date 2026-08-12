---
name: spec-to-code-verification
description: Verifies that implemented trading engine code, API routes, and database schemas strictly align with architectural specifications, zero-silent-change rules, and requirement documents — ensuring zero logic drift, unhandled edge cases, or undocumented parameter overrides. Use when verifying new feature implementations against specs before deployment.
---

# Spec-to-Code Verification

A rigorous, line-by-line verification pass comparing code implementations against formal functional specifications and architectural requirements.

## Verification Protocol

### 1. Requirements Tracing
- Trace every requirement in the specification to its corresponding source code file, function, and database schema field.
- Verify that every parameter constraint (e.g. `min_confidence >= 70`, `max_daily_loss <= $50`) is strictly enforced in code without implicit fallback overrides.

### 2. Zero-Silent-Change Verification
- Confirm that every configurable parameter change (risk, confidence, TP/SL, multipliers) routes through `ConfigRegistry.saveConfigVersion()`.
- Check that every edit creates an immutable version row (`config_versions`) and audit log entry (`config_audit_events`).
- Ensure no hardcoded parameter overrides exist in trading loop execution paths (`bot-engine.server.ts`, `signal-core.ts`).

### 3. API Contract & Database Alignment
- Compare API request/response payloads in `/api/admin/*` against front-end TypeScript interfaces.
- Validate that all SQL queries, PRAGMA schema migrations, and index definitions in `db.server.ts` match actual query patterns.

### 4. Edge Case & Drift Audit
- Verify null/undefined handling for non-finite inputs, optional parameters, and initial setup states.
- Check that preset symbol exclusions and inclusion watchlists are evaluated identically across client and server.
