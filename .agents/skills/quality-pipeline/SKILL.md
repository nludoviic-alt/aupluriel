---
name: quality-pipeline
description: Automated 10-stage continuous quality verification pipeline for trading engine modifications, code reviews, static analysis, unit/integration testing, security scans, trading logic audits, and performance verification. Use whenever validating code changes before release or performing a full quality review.
---

# Quality Pipeline — 10-Stage Verification System

This skill enforces a rigorous, automated 10-stage quality pipeline for all source code updates, trading engine modifications, and UI changes in the Au Pluriel project.

```
CODE MODIFIÉ
     ↓
Static Analysis
     ↓
Type Check
     ↓
Lint
     ↓
Security Scan
     ↓
Unit Tests
     ↓
Integration Tests
     ↓
Regression Tests
     ↓
Trading Logic Audit
     ↓
Performance Audit
     ↓
FINAL CODE REVIEW
     ↓
PASS / FAIL
```

---

## Pipeline Stages & Execution Guidelines

### Stage 1: Static Analysis
- **Goal**: Verify file structure integrity, module exports, and route manifests.
- **Checks**:
  - Ensure unused or obsolete routes are isolated outside `src/` (e.g. in `archived-routes/`) to prevent TanStack Router manifest pollution.
  - Verify that no duplicate file names or conflicting exports exist.

### Stage 2: Type Check
- **Command**: `npx tsc --noEmit`
- **Goal**: Zero TypeScript compilation errors across client, server, and API routes.
- **Criteria**: Must return exit code `0` with 0 errors.

### Stage 3: Lint
- **Command**: `npm run lint` (`eslint .`)
- **Goal**: Clean code style, no syntax warnings, no unused variables or unhandled JSX props.
- **Criteria**: Clean exit without unhandled linter errors.

### Stage 4: Security Scan
- **Goal**: Audit API endpoints and broker execution pathways.
- **Checks**:
  - Confirm API endpoints (`/api/bot`, `/api/opportunities`) enforce authentication, token verification, and payload bound checks.
  - Confirm Deriv execution safety: Strict `proposal -> validation -> buy` compliance. **NO UNVERIFIED PROPOSAL = NO BUY**.

### Stage 5: Unit Tests
- **Command**: `DB_PATH=:memory: npx tsx --test src/lib/__tests__/*.test.ts`
- **Goal**: Execute all unit test suites using the isolated in-memory SQLite provider.
- **Criteria**: 100% test pass rate across all files in `src/lib/__tests__/`.

### Stage 6: Integration Tests
- **Goal**: Verify database state persistence, settlement reconciliation, and risk pause transitions.
- **Checks**:
  - Test SQLite persistence for loss-streak circuit breakers (`PAUSED` -> `RECOVERY` -> `NORMAL`).
  - Verify multi-user and multi-preset data isolation in `bot_trades` and `bot_state`.

### Stage 7: Regression Tests
- **Goal**: Ensure existing trading strategy presets remain unbroken.
- **Checks**:
  - Verify preset definitions (`BOOM_PRESET`, `RB100_PRESET`, `VOL50_PRESET`, `CRASH1000`, etc.) use `stakeMode: "fixed"` with `$25` base stake and `$75` daily loss cap.
  - Confirm no silent configuration overrides occur upon preset selection or restart.

### Stage 8: Trading Logic Audit
- **Goal**: Verify signal scoring, confidence tiers, and dynamic stake scaling.
- **Checks**:
  - Confirm dynamic opportunity stake assignment (`computeOpportunityStake`):
    - Confidence 80% – 84% ➔ **$5.00 USD**
    - Confidence 85% – 89% ➔ **$10.00 USD**
    - Confidence ≥ 90% ➔ **$15.00 USD**
  - Confirm manual 1-click execution triggers single trade orders with correct sizing and visual feedback.

### Stage 9: Performance Audit
- **Goal**: Prevent CPU/memory drain and optimize rendering frequency.
- **Checks**:
  - Verify UI refresh timers (e.g., Opportunities page) run at a maximum frequency of 5 seconds (not 1 second).
  - Ensure background data sync occurs silently without full-tree React unmounting or UI flickering.

### Stage 10: Final Code Review & Mandatory Report
- **Goal**: Synthesize findings into the mandatory 16-point Quality Control Report.
- **Verdict**: Return **`PASS`** (all 10 stages satisfied) or **`FAIL`** (blocking errors remaining).

---

## Mandatory 16-Point Final Report Format

```markdown
1. Files Modified:
2. Functions Added:
3. Functions Removed:
4. Database Migrations:
5. Requirements Implemented:
6. Requirements Partial:
7. Requirements Missing:
8. Tests Added:
9. Tests Passed:
10. Tests Failed:
11. Risks Identified:
12. Potential Regressions:
13. Known Errors:
14. Final Status:
15. Deployment Verdict: [READY | NOT READY | READY WITH WARNINGS]
16. Rollback Procedure:
```
