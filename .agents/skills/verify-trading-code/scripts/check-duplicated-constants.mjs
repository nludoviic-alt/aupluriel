#!/usr/bin/env node
// Mechanical check for the one class of bug this codebase explicitly calls
// out as a risk: symbol lists that are DUPLICATED across files on purpose
// (server-side code can't import browser-only modules, so some constants are
// hand-copied instead of shared) — see the comment on BOOM_SYMS/CRASH_SYMS in
// src/lib/bot-engine.server.ts. If one copy is edited and the other isn't,
// server-side preset classification silently drifts from what the client
// actually trades. This script re-extracts each copy from source with a
// regex and diffs them — it does NOT catch every possible inconsistency in
// the codebase (see the rest of verify-trading-code's SKILL.md checklist for
// what still needs a human/agent read), only this one specific, sharp-edged
// pattern.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../../../");

function extractArray(filePath, constName) {
  const src = readFileSync(path.join(root, filePath), "utf8");
  const re = new RegExp(`${constName}[^=]*=\\s*\\[([^\\]]*)\\]`);
  const m = src.match(re);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function sameSet(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

const pairs = [
  {
    label: "Boom symbols",
    a: { file: "src/lib/autotrader.ts", const: "BOOM_SYMBOLS" },
    b: { file: "src/lib/bot-engine.server.ts", const: "BOOM_SYMS" },
  },
  {
    label: "Crash symbols",
    a: { file: "src/lib/autotrader.ts", const: "CRASH_SYMBOLS" },
    b: { file: "src/lib/bot-engine.server.ts", const: "CRASH_SYMS" },
  },
];

let anyDrift = false;
for (const p of pairs) {
  const a = extractArray(p.a.file, p.a.const);
  const b = extractArray(p.b.file, p.b.const);
  if (!a || !b) {
    console.log(`⚠ ${p.label}: could not extract one of the two constants (regex miss — check manually: ${p.a.file}:${p.a.const}, ${p.b.file}:${p.b.const})`);
    anyDrift = true;
    continue;
  }
  if (sameSet(a, b)) {
    console.log(`✓ ${p.label}: in sync (${a.length} symbols) — ${p.a.file}:${p.a.const} == ${p.b.file}:${p.b.const}`);
  } else {
    console.log(`✗ ${p.label}: DRIFTED`);
    console.log(`  ${p.a.file} ${p.a.const} = [${a.join(", ")}]`);
    console.log(`  ${p.b.file} ${p.b.const} = [${b.join(", ")}]`);
    anyDrift = true;
  }
}

process.exit(anyDrift ? 1 : 0);
