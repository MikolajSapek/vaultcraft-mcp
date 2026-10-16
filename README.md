# vaultcraft MCP server

Optional companion server for the [vaultcraft](https://github.com/MikolajSapek/vaultcraft) plugin. The plugin works without it. It is bundled only with the ChatGPT and Codex directory version, and anyone can add it to another MCP client.

Endpoint: `https://vaultcraft.sapcorp.eu/mcp` (Streamable HTTP, no sign-in).

## Tools

All three tools only compute and return a result. They are marked read-only, non-destructive and closed-world, and they never write anywhere.

| Tool | What it returns |
|---|---|
| `get_vault_config` | The `.obsidian` settings for a new studies, work, research or personal vault: graph colours per folder, hover previews, core plugins, and the callout and concept-card CSS snippets. |
| `get_note_template` | The vaultcraft Markdown template for a concept, lecture, detailed lecture, lab or bridge note. |
| `check_vault` | A report on notes passed in: broken `[[wikilinks]]` with a suggested fix, notes nothing links to, concept notes without a definition or example, definitions too long for the hover preview, and lectures that do not list their concepts. |

## Data

Notes sent to `check_vault` are processed in memory for that one request and then discarded. The server keeps no database, writes no files and does not log request bodies. See [PRIVACY.md](https://github.com/MikolajSapek/vaultcraft/blob/main/PRIVACY.md).

## Run it

```bash
npm ci
npm test          # starts the server and checks every tool over HTTP
npm start         # http://localhost:8787/mcp
```

Add it to Claude Code:

```bash
claude mcp add --transport http vaultcraft https://vaultcraft.sapcorp.eu/mcp
```

## Deploy

The container runs next to an existing Cloudflare tunnel (`docker-compose.yml`, network `n8n_default`). No host port is published. `OPENAI_APPS_CHALLENGE` in `.env` serves the OpenAI domain-verification token at `/.well-known/openai-apps-challenge`.

After changing the templates in vaultcraft, run `scripts/sync-templates.sh ../vaultcraft`.

## License

MIT
