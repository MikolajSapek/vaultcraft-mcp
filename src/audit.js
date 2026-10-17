// The vaultcraft Phase 9 quality pass as a pure function: broken links, orphan notes,
// concept notes without a definition or example, and lectures that do not list the
// concepts that name them as their source. Nothing here touches disk or network.

// Keep these rules in step with vaultcraft skills/vaultcraft/scripts/check_vault.py (test/parity.test.js).
const NAV_NOTES = new Set(["00 - start here", "readme_plugins", "01 - course map", "tables"]);
const LIST_CAP = 50;
const DEFINITION_MAX = 200;
const TARGET_MAX = 200;
const LINKS_MAX = 50_000;
const FUZZY_MAX = 48;

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

function aliases(fm) {
  const inline = fm.match(/^aliases:\s*\[(.*?)\]/m);
  if (inline) return inline[1].split(",").map((a) => a.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const block = fm.match(/^aliases:\s*\n((?:\s*-\s*.+\n?)+)/m);
  return block ? block[1].split("\n").map((a) => a.trim().replace(/^-\s*/, "").replace(/^["']|["']$/g, "")).filter(Boolean) : [];
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
  // Edit distance only for short names, and only against names of similar length: keeps a request cheap.
  if (t.length > FUZZY_MAX) return null;
  const limit = Math.max(2, Math.floor(t.length / 4));
  let best = null;
  let bestScore = Infinity;
  for (const name of names) {
    if (Math.abs(name.length - t.length) > limit) continue;
    const score = levenshtein(t, name.toLowerCase());
    if (score < bestScore) [best, bestScore] = [name, score];
  }
  return t.length >= 5 && bestScore <= limit ? best : null;
}


/**
 * @param {{path: string, content: string}[]} notes  Markdown notes of the vault.
 * @param {string[]} attachments  Paths of non-note files (PDFs, images) in the vault.
 * @param {number} listCap  Longest list returned per problem type.
 */
export function auditVault(notes, attachments = [], listCap = LIST_CAP) {
  const cap = (list) => list.slice(0, listCap);
  // Two notes can share a name in different folders; both checks resolve to the first path.
  const sortedNotes = [...notes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const contentOf = new Map(sortedNotes.map((n) => [n.path, n.content]));
  const byKey = new Map();
  const aliasKeys = new Map();
  for (const n of sortedNotes) if (!byKey.has(key(baseName(n.path)))) byKey.set(key(baseName(n.path)), n.path);
  for (const n of sortedNotes) {
    for (const a of aliases(frontmatter(n.content))) if (!aliasKeys.has(key(a))) aliasKeys.set(key(a), n.path);
  }
  const names = [...new Set(sortedNotes.map((n) => baseName(n.path)))];
  // Obsidian also resolves [[Dashboard]] to Dashboard.base, so match attachments with and without extension.
  const attachmentNames = new Set(attachments.flatMap((p) => {
    const file = p.split("/").pop();
    return [p, file, file.replace(/\.[^.]+$/, "")].map(key);
  }));
  const inbound = new Map(sortedNotes.map((n) => [n.path, 0]));
  const outbound = new Map();
  const broken = [];

  let linkCount = 0;
  for (const note of sortedNotes) {
    const linked = new Set();
    const reported = new Set();
    for (const { raw, embed } of linkTargets(note.content)) {
      if (++linkCount > LINKS_MAX) throw new Error(`More than ${LINKS_MAX} links: check the vault in parts.`);
      if (raw.length > TARGET_MAX) continue;
      const target = byKey.get(key(baseName(raw))) ?? aliasKeys.get(key(raw));
      if (target) {
        if (target !== note.path) linked.add(target);
      } else if (!attachmentNames.has(key(raw)) && !attachmentNames.has(key(raw.split("/").pop())) && !reported.has(raw)) {
        reported.add(raw);
        // Suggestions cost a scan of every name, so only the reported links get one.
        const suggestion = embed || broken.length >= Math.min(listCap, LIST_CAP) ? null : suggest(baseName(raw), names);
        broken.push({ note: note.path, target: raw, embed, suggestion });
      }
    }
    outbound.set(note.path, linked);
    for (const t of linked) inbound.set(t, inbound.get(t) + 1);
  }

  const orphans = [...inbound].filter(([p, c]) => c === 0 && !NAV_NOTES.has(key(baseName(p)))).map(([p]) => baseName(p));
  const missingDefinition = [];
  const longDefinition = [];
  const missingExample = [];
  const fewLinks = [];
  const missingBacklinks = [];
  let concepts = 0;

  for (const [path, content] of contentOf) {
    const name = baseName(path);
    const fm = frontmatter(content);
    if (!isConcept(fm)) continue;
    concepts++;
    const definition = definitionText(content);
    if (!definition) missingDefinition.push(name);
    else if (definition.length > DEFINITION_MAX) longDefinition.push(name);
    if (!hasExample(content)) missingExample.push(name);
    if (outbound.get(path).size < 2) fewLinks.push(name);
    const lecture = byKey.get(key(sourceLecture(fm) ?? ""));
    if (lecture && !outbound.get(lecture).has(path)) {
      missingBacklinks.push({ lecture: baseName(lecture), concept: name });
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
