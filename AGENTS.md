# Quality Control, Workflow & Engineering Guidelines

This project enforces an industrial-grade quant engineering workflow with strict role separation, quality gates, mandatory post-implementation reporting, and automated validation.

---

## 4-Role Separated Development Pipeline

All non-trivial feature implementations, risk engine modifications, and trading strategy changes must pass through four distinct roles:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. SPECIFICATION                                                            │
│ Define functional & risk requirements before writing code                   │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. BUILDER                                                                  │
│ Writes and modifies source code, DB migrations, and API routes              │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. CODE REVIEWER                                                            │
│ Inspects code for logic flaws, complexity, dead code, race conditions, etc. │
│ Can reject implementation even if it compiles cleanly                       │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. TESTER / REGRESSION TESTER                                               │
│ Intentionally tries to break the system (unit, integration & edge cases)    │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. SPEC-TO-CODE AUDITOR                                                     │
│ Produces requirement verification matrix (YES / NO / PARTIAL)               │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 6. PRODUCTION READINESS AUDITOR                                             │
│ Final gatekeeper verdict: READY / NOT READY / READY WITH WARNINGS           │
└─────────────────────────────────────────────────────────────────────────────┘
```

> **CRITICAL RULE**: The **BUILDER** must NEVER be the sole validator of their own implementation.

---

## Quality Gate Checklist

A feature is strictly **NOT FINISHED** until ALL of the following criteria are met:
1. [ ] Source code exists and compiles without errors.
2. [ ] Unit & integration tests exist and pass cleanly.
3. [ ] Code Reviewer pass confirms clean architecture, typing, and safety.
4. [ ] Deriv Execution Safety pass confirms strict `proposal -> validation -> buy` compliance (**NO VALID PROPOSAL = NO BUY**).
5. [ ] Risk Manager Auditor confirms strict risk isolation (no indicator math inside Risk Engine, no martingale).
6. [ ] Zero silent parameter changes (all edits logged via `ConfigRegistry`).
7. [ ] Regression Tester confirms existing strategy presets remain unbroken.
8. [ ] Production Readiness Auditor returns **READY** or **READY WITH WARNINGS**.

---

## Mandatory 16-Point Final Report

Every major code update or strategy modification must conclude with a structured report covering:

1. **Files Modified**: List of changed source files with links.
2. **Functions Added**: New exported methods and classes.
3. **Functions Removed**: Deprecated or refactored functions.
4. **Database Migrations**: New SQLite tables, columns, or indexes.
5. **Requirements Implemented**: Requirements marked `YES`.
6. **Requirements Partial**: Requirements marked `PARTIAL` with open gaps.
7. **Requirements Missing**: Requirements marked `NO`.
8. **Tests Added**: New test files or test functions created.
9. **Tests Passed**: Number of successful automated checks.
10. **Tests Failed**: Failing assertions or unhandled exceptions.
11. **Risks Identified**: Edge-case risks, latency issues, or financial exposure hazards.
12. **Potential Regressions**: Areas that could be impacted by this change.
13. **Known Errors**: Known warnings or non-blocking issues.
14. **Final Status**: Summary of progress.
15. **Deployment Verdict**: `READY` | `NOT READY` | `READY WITH WARNINGS`.
16. **Rollback Procedure**: Step-by-step instructions to revert changes instantly.
