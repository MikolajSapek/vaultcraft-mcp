// vaultcraft MCP server: stateless Streamable HTTP, no auth, no storage.
// Tools only compute and return. Request bodies are never logged or kept.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { auditVault, formatReport } from "./audit.js";
import { VAULT_TYPES, folderList, vaultConfigFiles } from "./config.js";

const PORT = Number(process.env.PORT ?? 8787);
const CHALLENGE = process.env.OPENAI_APPS_CHALLENGE ?? "";
const MAX_BODY = 4 * 1024 * 1024;
const RATE_LIMIT = 60; // requests per client per minute
const hits = new Map();

// ponytail: in-memory per-IP window, fine for one process; move to Cloudflare rules if it scales out.
function rateLimited(req) {
  const ip = req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "";
  const minute = Math.floor(Date.now() / 60_000);
  const entry = hits.get(ip);
  if (!entry || entry.minute !== minute) {
    if (hits.size > 10_000) hits.clear();
    hits.set(ip, { minute, count: 1 });
    return false;
  }
  return ++entry.count > RATE_LIMIT;
}
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;

const TEMPLATE_KINDS = ["concept", "lecture", "lecture-golden", "lab", "bridge"];
const TEMPLATES = Object.fromEntries(
  TEMPLATE_KINDS.map((k) => [k, readFileSync(new URL(`../templates/${k}.md`, import.meta.url), "utf8")]),
);

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };

function buildServer() {
  const server = new McpServer(
    { name: "vaultcraft", version: VERSION },
    {
      instructions:
        "Tools for building Obsidian study, work and research vaults with the vaultcraft skill. "
        + "Call get_vault_config once when starting a new vault, get_note_template before writing a note type, "
        + "and check_vault on the finished notes before handing the vault to the user.",
    },
  );

  server.registerTool(
    "get_vault_config",
    {
      title: "Get Obsidian vault settings",
      description:
        "Returns the .obsidian settings files for a new vault of the given type: graph colours per folder, "
        + "hover previews, core plugins and the callout and concept-card CSS snippets, plus the folder list. "
        + "Use when creating a new vault. Do not use on an existing vault, whose settings belong to the user.",
      inputSchema: {
        vault_type: z.enum(VAULT_TYPES).describe("Kind of vault: studies, work, research or personal."),
        spellcheck_language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("en-US")
          .describe("Spellcheck language code for the notes, for example en-US or pl."),
      },
      annotations: READ_ONLY,
    },
    async ({ vault_type, spellcheck_language }) => {
      const files = vaultConfigFiles(vault_type, spellcheck_language);
      const folders = folderList(vault_type);
      return {
        content: [{ type: "text", text: `Settings for a ${vault_type} vault: ${files.map((f) => f.path).join(", ")}. Folders: ${folders.join(", ")}.` }],
        structuredContent: { vault_type, folders, files },
      };
    },
  );

  server.registerTool(
    "get_note_template",
    {
      title: "Get a vaultcraft note template",
      description:
        "Returns the Markdown template vaultcraft uses for one note type: concept (atomic note with a hover "
        + "definition), lecture, lecture-golden (detailed lecture walkthrough), lab, or bridge (link between two courses).",
      inputSchema: { kind: z.enum(TEMPLATE_KINDS).describe("Which note template to return.") },
      annotations: READ_ONLY,
    },
    async ({ kind }) => ({
      content: [{ type: "text", text: TEMPLATES[kind] }],
      structuredContent: { kind, template: TEMPLATES[kind] },
    }),
  );

  server.registerTool(
    "check_vault",
    {
      title: "Check a vault for broken links and gaps",
      description:
        "Checks Markdown notes the way Obsidian resolves them: broken [[wikilinks]] with a suggested fix, notes "
        + "nothing links to, concept notes without a definition callout or example, definitions too long for the "
        + "hover preview, and lectures that do not list their concepts. Pass the notes you wrote in this "
        + "conversation. Read-only: returns a report and changes nothing.",
      inputSchema: {
        notes: z.array(z.object({
          path: z.string().min(1).max(300).describe("Path inside the vault, for example Concepts/TF-IDF.md."),
          content: z.string().max(200_000).describe("Full Markdown of the note."),
        })).min(1).max(1000),
        attachments: z.array(z.string().max(300)).max(2000).default([])
          .describe("Paths of PDFs and images in the vault, so embeds of them are not reported as broken."),
      },
      annotations: READ_ONLY,
    },
    async ({ notes, attachments }) => {
      const result = auditVault(notes, attachments);
      return { content: [{ type: "text", text: formatReport(result) }], structuredContent: result };
    },
  );

  return server;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function handleMcp(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, err.status ?? 400, { jsonrpc: "2.0", error: { code: -32700, message: err.message }, id: null });
  }
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const httpServer = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  try {
    if (path === "/mcp") {
      if (rateLimited(req)) return sendJson(res, 429, { jsonrpc: "2.0", error: { code: -32000, message: "Too many requests" }, id: null });
      return await handleMcp(req, res);
    }
    if (path === "/.well-known/openai-apps-challenge" && CHALLENGE) {
      return res.writeHead(200, { "content-type": "text/plain" }).end(CHALLENGE);
    }
    if (path === "/healthz") return res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    if (path === "/") {
      res.writeHead(302, { location: "https://github.com/MikolajSapek/vaultcraft" });
      return res.end();
    }
    sendJson(res, 404, { error: "Not found" });
  } catch {
    // No request details in logs: they can contain the user's notes.
    process.stderr.write(`request failed: ${req.method} ${path}\n`);
    if (!res.headersSent) sendJson(res, 500, { error: "Internal error" });
  }
});

httpServer.listen(PORT, () => process.stdout.write(`vaultcraft MCP ${VERSION} on :${PORT}/mcp\n`));
