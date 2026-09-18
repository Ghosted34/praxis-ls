"use strict";
/**
 * Audit B5 — ask() and askStream() build their system prompt from ONE shared
 * builder, so the ~2–3 KB rules block can no longer drift between the two paths
 * (it did — PR 4 touched one copy for the per-user blocks), and the static
 * prefix is a single constant the provider can cache.
 */
const fs = require("fs");
const path = require("path");
const orch = require("../../src/services/ai/orchestrator.service");

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../../src/services/ai/orchestrator.service.js"),
  "utf8",
);

test("the static prefix is one constant, independent of the dynamic inputs", () => {
  const a = orch.buildSystemPrompt({ user: { display_name: "Ada" }, mode: "draft", hits: [] });
  const b = orch.buildSystemPrompt({
    user: { display_name: "Bo", email: "bo@example.io" },
    mode: "analyse",
    patternBlock: "\n\nPATTERN-MARKER",
    feedbackBlock: "\n\nFEEDBACK-MARKER",
    prefsBlock: "\n\nPREFS-MARKER",
    hits: [{ ref: "doc:kb", content: "ctx" }],
  });

  // The two paths (ask/askStream) call this same builder, so the static prefix
  // they send is necessarily identical — and equal to the single source constant.
  expect(a.staticPrefix).toBe(b.staticPrefix);
  expect(a.staticPrefix).toBe(orch.SYSTEM_RULES);
  expect(a.staticPrefix).toContain("You are Praxis LS, an OHADA-aware logistics ERP assistant");
});

test("full = static prefix + the per-turn dynamic tail", () => {
  const p = orch.buildSystemPrompt({
    user: { display_name: "Ada" },
    mode: "draft",
    patternBlock: "\n\nPATTERN-MARKER",
    hits: [],
  });
  expect(p.full.startsWith(p.staticPrefix)).toBe(true);
  expect(p.dynamic).toContain("Ada"); // who-is-asking
  expect(p.dynamic).toContain("MODE — DRAFT"); // the mode directive
  expect(p.dynamic).toContain("PATTERN-MARKER"); // the learned-pattern block
  expect(p.dynamic).toContain("CONTEXT:"); // the retrieved context header
  // The static prefix carries none of the per-turn material.
  expect(p.staticPrefix).not.toContain("Ada");
  expect(p.staticPrefix).not.toContain("MODE — DRAFT");
});

test("the rules block exists in exactly ONE place (no duplicated string)", () => {
  const phrase = "You are Praxis LS, an OHADA-aware logistics ERP assistant";
  const occurrences = SRC.split(phrase).length - 1;
  expect(occurrences).toBe(1);
});

test("both ask() and askStream() build from the shared builder", () => {
  const callSites = SRC.split("buildSystemPrompt({ user, patternBlock, feedbackBlock, prefsBlock, mode, hits })").length - 1;
  expect(callSites).toBe(2);
});
