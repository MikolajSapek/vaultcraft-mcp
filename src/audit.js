// The vaultcraft Phase 9 quality pass as a pure function: broken links, orphan notes,
// concept notes without a definition or example, and lectures that do not list the
// concepts that name them as their source. Nothing here touches disk or network.

const NAV_NOTES = new Set(["00 - Start Here", "README_PLUGINS", "01 - Course Map", "Tables"]);
const LIST_CAP = 50;
const DEFINITION_MAX = 200;

const stripCode = (text) => text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
// Obsidian resolves links case-insensitively, so names are compared in lower case.
const baseName = (path) => path.split("/").pop().replace(/\.md$/i, "");
const key = (name) => name.toLowerCase();

/** Wikilink targets in a note: [[Target]], [[Folder/Target|alias]], ![[file.pdf#page=2]]. */
function linkTargets(text) {
  const targets = [];
  for (const m of stripCode(text).matchAll(/(!?)\[\[([^\]|#^]+)(?:[|#^][^\]]*)?\]\]/g)) {
    // In tables the alias pipe is escaped: [[Note\\|alias]].
    const raw = m[2].replace(/\\$/, "").trim();
    if (raw) targets.push({ raw, embed: m[1] === "!" });
  }
  return targets;
}

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : "";
}

function isConcept(fm) {
  return /^tags:.*\bconcept\b/m.test(fm) || /^\s*-\s*concept\s*$/m.test(fm);
}

function sourceLecture(fm) {
  const m = fm.match(/^source:\s*["']?\[\[([^\]|#]+)/m);
  return m ? m[1].trim() : null;
}

function definitionText(text) {
  const m = text.match(/^>\s*\[!definition\][^\n]*\n((?:>[^\n]*\n?)+)/im);
  return m ? m[1].replace(/^>\s?/gm, "").trim() : null;
}

function hasExample(text) {
  return /^>\s*\[!example\]/im.test(text) || /^#{2,4}\s+.*example/im.test(text);
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

function suggest(target, names) {
  const t = target.toLowerCase();
  const prefixed = [...names].find((n) => n.toLowerCase().startsWith(t) || t.startsWith(n.toLowerCase()));
  if (prefixed && Math.min(t.length, prefixed.length) / Math.max(t.length, prefixed.length) >= 0.5) return prefixed;
  let best = null;
  let bestScore = Infinity;
  for (const name of names) {
    const score = levenshtein(t, name.toLowerCase());
    if (score < bestScore) [best, bestScore] = [name, score];
  }
  return t.length >= 5 && bestScore <= Math.max(2, Math.floor(t.length / 4)) ? best : null;
}

const cap = (list) => list.slice(0, LIST_CAP);

/**
 * @param {{path: string, content: string}[]} notes  Markdown notes of the vault.
 * @param {string[]} attachments  Paths of non-note files (PDFs, images) in the vault.
 */
export function auditVault(notes, attachments = []) {
  const byKey = new Map(notes.map((n) => [key(baseName(n.path)), baseName(n.path)]));
  const names = [...byKey.values()];
  // Obsidian also resolves [[Dashboard]] to Dashboard.base, so match attachments with and without extension.
  const attachmentNames = new Set(attachments.flatMap((p) => {
    const file = p.split("/").pop();
    return [p, file, file.replace(/\.[^.]+$/, "")].map(key);
  }));
  const inbound = new Map(names.map((n) => [n, 0]));
  const outbound = new Map();
  const broken = [];

  for (const note of notes) {
    const from = baseName(note.path);
    const linked = new Set();
    const reported = new Set();
    for (const { raw, embed } of linkTargets(note.content)) {
      const target = byKey.get(key(baseName(raw)));
      if (target) {
        if (target !== from) linked.add(target);
      } else if (!attachmentNames.has(key(raw)) && !attachmentNames.has(key(raw.split("/").pop())) && !reported.has(raw)) {
        reported.add(raw);
        broken.push({ note: note.path, target: raw, embed, suggestion: embed ? null : suggest(baseName(raw), names) });
      }
    }
    outbound.set(from, linked);
    for (const t of linked) inbound.set(t, inbound.get(t) + 1);
  }

  const orphans = [...inbound].filter(([n, c]) => c === 0 && !NAV_NOTES.has(n)).map(([n]) => n);
  const missingDefinition = [];
  const longDefinition = [];
  const missingExample = [];
  const fewLinks = [];
  const missingBacklinks = [];
  let concepts = 0;

  for (const note of notes) {
    const name = baseName(note.path);
    const fm = frontmatter(note.content);
    if (!isConcept(fm)) continue;
    concepts++;
    const definition = definitionText(note.content);
    if (!definition) missingDefinition.push(name);
    else if (definition.length > DEFINITION_MAX) longDefinition.push(name);
    if (!hasExample(note.content)) missingExample.push(name);
    if (outbound.get(name).size < 2) fewLinks.push(name);
    const lecture = byKey.get(key(sourceLecture(fm) ?? ""));
    if (lecture && !outbound.get(lecture).has(name)) {
      missingBacklinks.push({ lecture, concept: name });
    }
  }

  const issues = broken.length + orphans.length + missingDefinition.length + longDefinition.length
    + missingExample.length + fewLinks.length + missingBacklinks.length;
  return {
    summary: {
      notes: notes.length,
      concepts,
      wikilinks: [...outbound.values()].reduce((sum, s) => sum + s.size, 0),
      issues,
    },
    brokenLinks: cap(broken),
    orphanNotes: cap(orphans),
    conceptsMissingDefinition: cap(missingDefinition),
    definitionsOver200Chars: cap(longDefinition),
    conceptsMissingExample: cap(missingExample),
    conceptsWithUnder2Links: cap(fewLinks),
    lecturesMissingConcept: cap(missingBacklinks),
  };
}

/** The same result as the plain-text report vaultcraft prints at the end of a run. */
export function formatReport(r) {
  const lines = [
    `Quality report: ${r.summary.notes} notes, ${r.summary.concepts} concepts, ${r.summary.wikilinks} links between notes`,
    `Broken links:            ${r.brokenLinks.length}`,
    `Orphan notes:            ${r.orphanNotes.length}`,
    `Missing definition:      ${r.conceptsMissingDefinition.length}`,
    `Definition over 200 ch.: ${r.definitionsOver200Chars.length}`,
    `Missing example:         ${r.conceptsMissingExample.length}`,
    `Under 2 outbound links:  ${r.conceptsWithUnder2Links.length}`,
    `Lecture misses concept:  ${r.lecturesMissingConcept.length}`,
  ];
  if (r.summary.issues === 0) lines.push("No issues found.");
  for (const b of r.brokenLinks.slice(0, 10)) {
    lines.push(`- ${b.note}: [[${b.target}]] not found${b.suggestion ? `; did you mean [[${b.suggestion}]]?` : ""}`);
  }
  return lines.join("\n");
}
