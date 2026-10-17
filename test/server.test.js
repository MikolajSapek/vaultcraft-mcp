import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { auditVault } from "../src/audit.js";

const PORT = 18787;
const URL_MCP = `http://127.0.0.1:${PORT}/mcp`;
let child;

before(async () => {
  child = spawn(process.execPath, ["src/server.js"], {
    env: { ...process.env, PORT: String(PORT), OPENAI_APPS_CHALLENGE: "token-123", RATE_LIMIT: "60" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve) => child.stdout.once("data", resolve));
});
after(() => child.kill());

let id = 0;
async function rpc(method, params = {}) {
  const res = await fetch(URL_MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(!body.error, JSON.stringify(body.error));
  return body.result;
}

test("initialize advertises tools and instructions", async () => {
  const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  assert.equal(r.serverInfo.name, "vaultcraft");
  assert.ok(r.capabilities.tools);
  assert.match(r.instructions, /check_vault/);
});

test("every tool is read-only, non-destructive, closed-world", async () => {
  const { tools } = await rpc("tools/list");
  assert.deepEqual(tools.map((t) => t.name).sort(), ["check_vault", "get_note_template", "get_vault_config"]);
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
    assert.equal(t.annotations.openWorldHint, false, t.name);
    assert.ok(t.description.length > 40, t.name);
  }
});

test("get_vault_config returns graph colours for the folders", async () => {
  const r = await rpc("tools/call", { name: "get_vault_config", arguments: { vault_type: "work" } });
  const graph = JSON.parse(r.structuredContent.files.find((f) => f.path === ".obsidian/graph.json").content);
  assert.deepEqual(graph.colorGroups.map((g) => g.query), r.structuredContent.folders.map((f) => `path:${f}/`));
  assert.ok(r.structuredContent.files.some((f) => f.path === ".obsidian/snippets/callouts.css"));
});

test("get_note_template returns the concept template", async () => {
  const r = await rpc("tools/call", { name: "get_note_template", arguments: { kind: "concept" } });
  assert.match(r.content[0].text, /\[!definition\]/);
});

test("bad input is rejected as a tool error, not a crash", async () => {
  const r = await rpc("tools/call", { name: "get_note_template", arguments: { kind: "poem" } });
  assert.equal(r.isError, true);
});

test("check_vault over HTTP finds a broken link with a suggestion", async () => {
  const notes = [
    { path: "Concepts/TF-IDF.md", content: "---\ntags: [concept]\n---\n> [!definition] Def\n> Weights words.\n\nSee [[Bag of Word]] and [[Lecture 1]]." },
    { path: "Concepts/Bag of Words.md", content: "Counts words. [[TF-IDF]]" },
    { path: "Lectures/Lecture 1.md", content: "Intro." },
  ];
  const r = await rpc("tools/call", { name: "check_vault", arguments: { notes } });
  assert.deepEqual(r.structuredContent.brokenLinks[0], { note: "Concepts/TF-IDF.md", target: "Bag of Word", embed: false, suggestion: "Bag of Words" });
});

test("domain challenge returns the bare token", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/.well-known/openai-apps-challenge`);
  assert.equal(await res.text(), "token-123");
});

test("oversized body is refused", async () => {
  const res = await fetch(URL_MCP, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(5 * 1024 * 1024) }).catch(() => null);
  assert.ok(!res || res.status === 413);
});

test("audit: concept checks, orphans, lecture backlinks, code is ignored", () => {
  const r = auditVault([
    { path: "Lectures/L01 - Intro.md", content: "# L01\n[[Alpha]]" },
    { path: "Concepts/Alpha.md", content: "---\ntags: [concept]\nsource: \"[[L01 - Intro]]\"\n---\n> [!definition] Alpha\n> Short.\n\n> [!example] Ex\n> one\n\n[[Beta]] [[L01 - Intro]]" },
    { path: "Concepts/Beta.md", content: "---\ntags: [concept]\nsource: \"[[L01 - Intro]]\"\n---\nNo callout. `[[Ghost]]`\n```\n[[Ghost2]]\n```\n![[slides.pdf#page=3]]" },
    { path: "00 - Start Here.md", content: "start" },
  ], ["Assets/slides.pdf"]);
  assert.equal(r.brokenLinks.length, 0);
  assert.deepEqual(r.conceptsMissingDefinition, ["Beta"]);
  assert.deepEqual(r.conceptsMissingExample, ["Beta"]);
  assert.deepEqual(r.conceptsWithUnder2Links, ["Beta"]);
  assert.deepEqual(r.lecturesMissingConcept, [{ lecture: "L01 - Intro", concept: "Beta" }]);
  assert.deepEqual(r.orphanNotes, []);
  assert.equal(r.summary.concepts, 2);
});

test("audit: escaped table pipes, .base targets, duplicates and close names", () => {
  const r = auditVault([
    { path: "Home.md", content: "| a | [[Index\\|files]] |\n[[Dashboard]] [[Common Table Expression]] [[Common Table Expression]]" },
    { path: "Index.md", content: "[[Home]]" },
    { path: "Concepts/Common Table Expression (CTE).md", content: "[[Home]]" },
  ], ["Dashboard.base"]);
  assert.deepEqual(r.brokenLinks, [
    { note: "Home.md", target: "Common Table Expression", embed: false, suggestion: "Common Table Expression (CTE)" },
  ]);
});

test("audit: links resolve case-insensitively like Obsidian; short names get no guess", () => {
  const r = auditVault([
    { path: "A.md", content: "[[tidyverse]] [[DDL]]" },
    { path: "Tidyverse.md", content: "[[a]]" },
    { path: "DCL.md", content: "[[A]]" },
  ]);
  assert.deepEqual(r.brokenLinks, [{ note: "A.md", target: "DDL", embed: false, suggestion: null }]);
});

test("audit: a huge broken target and many names stay fast", () => {
  const notes = Array.from({ length: 1000 }, (_, i) => ({ path: `N${i} ${"x".repeat(40)}.md`, content: "" }));
  notes.push({ path: "Big.md", content: `[[${"a".repeat(190_000)}]] ` + Array.from({ length: 200 }, (_, i) => `[[missing ${i} ${"y".repeat(36)}]]`).join(" ") });
  const t = Date.now();
  const r = auditVault(notes);
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
  assert.equal(r.brokenLinks.length, 50);
});

test("rate limit answers 429 once the shared per-minute window is full", async () => {
  const send = () => fetch(URL_MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const statuses = [];
  for (let i = 0; i < 130; i++) statuses.push((await send()).status);
  assert.ok(statuses.includes(429), "window never filled");
});
