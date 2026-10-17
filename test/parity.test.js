// check_vault here (JS, for the ChatGPT/Codex server) and in vaultcraft
// (skills/vaultcraft/scripts/check_vault.py, run locally) must report the same problems.
// Needs a vaultcraft checkout: VAULTCRAFT_DIR, default ../vaultcraft.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { auditVault } from "../src/audit.js";

const VAULTCRAFT = process.env.VAULTCRAFT_DIR ?? new URL("../../vaultcraft", import.meta.url).pathname;
const SCRIPT = join(VAULTCRAFT, "skills/vaultcraft/scripts/check_vault.py");
const SKIP = new Set([".obsidian", ".vaultcraft", ".trash", ".git"]);

function readVault(root) {
  const notes = [];
  const attachments = [];
  (function walk(dir) {
    for (const f of readdirSync(dir)) {
      if (SKIP.has(f)) continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.toLowerCase().endsWith(".md")) notes.push({ path: relative(root, p), content: readFileSync(p, "utf8") });
      else attachments.push(relative(root, p));
    }
  })(root);
  return { notes, attachments };
}

const sorted = (list) => [...list].sort();

function compare(root) {
  // The script exits 1 when the vault has problems, so read stdout either way.
  const run = spawnSync("python3", [SCRIPT, root, "--json"], { encoding: "utf8", maxBuffer: 64e6 });
  assert.ok(run.status === 0 || run.status === 1, run.stderr);
  const py = JSON.parse(run.stdout);
  const { notes, attachments } = readVault(root);
  // Uncapped lists: a list cap of 50 would hide differences in a big vault.
  const js = auditVault(notes, attachments, Infinity);
  assert.deepEqual(sorted(js.brokenLinks.map((b) => `${b.note} :: ${b.target}`)), sorted(py.broken_links.map((b) => `${b.note} :: ${b.target}`)), "broken links");
  assert.deepEqual(sorted(js.orphanNotes), sorted(py.orphan_notes), "orphans");
  assert.deepEqual(sorted(js.conceptsMissingDefinition), sorted(py.missing_definition), "missing definition");
  assert.deepEqual(sorted(js.definitionsOver200Chars), sorted(py.long_definition), "long definition");
  assert.deepEqual(sorted(js.conceptsMissingExample), sorted(py.missing_example), "missing example");
  assert.deepEqual(sorted(js.conceptsWithUnder2Links), sorted(py.under_2_links), "under 2 links");
  assert.deepEqual(sorted(js.lecturesMissingConcept.map((m) => `${m.lecture} -> ${m.concept}`)), sorted(py.lecture_misses_concept), "lecture backlinks");
}

const FIXTURE = {
  "Concepts/TF-IDF.md": "---\ntags: [concept]\nsource: \"[[L01 - Intro]]\"\n---\n> [!definition] TF-IDF\n> Weights a word by how rare it is.\n\nBuilds on [[Bag of Word]] and [[bow]]. `[[Ignored]]`\n```\n[[Also ignored]]\n```\n",
  "Concepts/Bag of Words.md": "---\ntags:\n  - concept\naliases:\n  - BoW\n---\n> [!definition] Bag of Words\n> " + "Counts words. ".repeat(20) + "\n\n## Worked example\nx\n\n| a | [[tf-idf\\|weights]] | ![[slides.pdf#page=2]] ![[Dashboard]]\n",
  "Lectures/L01 - Intro.md": "First lecture. [[Ghost]] [[Folder/Bag of Words]]",
  "00 - Start Here.md": "[[TF-IDF]]",
  "Concepts/Lonely.md": "---\ntags: [concept]\n---\nNo callout.",
  "Assets/slides.pdf": "",
  "Dashboard.base": "",
};

test("JS and Python checks agree on the edge-case fixture", { skip: !existsSync(SCRIPT) && `no vaultcraft checkout at ${VAULTCRAFT}` }, () => {
  const root = mkdtempSync(join(tmpdir(), "vc-parity-"));
  try {
    for (const [p, c] of Object.entries(FIXTURE)) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), c);
    }
    compare(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const REAL = process.env.PARITY_VAULT ?? join(homedir(), "ObsidianVaults/Datascience-2026");
test("JS and Python checks agree on a real vault", { skip: !(existsSync(SCRIPT) && existsSync(REAL)) && "no real vault" }, () => {
  compare(REAL);
});
