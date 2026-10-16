// Obsidian settings for a new vault, ported from vaultcraft's Phase 2.5
// (skills/vaultcraft/references/phase-2-3-extract.md). Keep the two in step.

const COLORS = [15778400, 5793266, 14914867, 15913728, 4170580, 8978687];

const GRAPH_FOLDERS = {
  studies: ["Lectures", "Labs", "Concepts", "Formulas", "Examples"],
  work: ["Meetings", "Projects", "Companies", "People", "Decisions", "Concepts"],
  research: ["Papers", "Concepts", "Methods", "Hypotheses", "Data"],
  personal: ["Topics", "Concepts", "Practice", "Inspiration", "Journal"],
};

const GRAPH_HIDDEN = {
  studies: ["00 - Start Here", "README_PLUGINS", "01 - Course Map", "Tables"],
  work: ["00 - Start Here", "README_PLUGINS"],
  research: ["00 - Start Here", "README_PLUGINS"],
  personal: ["00 - Start Here", "README_PLUGINS"],
};

const CALLOUTS = {
  studies: `.callout[data-callout="definition"] {
    --callout-color: 56, 139, 253;
    --callout-icon: "book-open";
}
.callout[data-callout="definition"] .callout-title {
    font-weight: 700;
    font-size: 1.05em;
}
.callout[data-callout="example"]  { --callout-color: 46, 160, 67;  --callout-icon: "lightbulb"; }
.callout[data-callout="question"] { --callout-color: 163, 113, 247; --callout-icon: "help-circle"; }
.callout[data-callout="important"]{ --callout-color: 248, 81, 73;  --callout-icon: "alert-triangle"; }
.callout[data-callout="exam"]     { --callout-color: 210, 153, 34;  --callout-icon: "graduation-cap"; }
`,
  work: `.callout[data-callout="decision"] { --callout-color: 31, 111, 235;  --callout-icon: "check-square"; }
.callout[data-callout="action"]   { --callout-color: 234, 139, 0;   --callout-icon: "zap"; }
.callout[data-callout="risk"]     { --callout-color: 248, 81, 73;   --callout-icon: "alert-triangle"; }
.callout[data-callout="meeting"]  { --callout-color: 20, 184, 166;  --callout-icon: "users"; }
.callout[data-callout="stakeholder"] { --callout-color: 139, 92, 246; --callout-icon: "user"; }
.callout[data-callout="tldr"]     { --callout-color: 100, 116, 139; --callout-icon: "align-left"; }
`,
};
CALLOUTS.research = CALLOUTS.studies;
CALLOUTS.personal = CALLOUTS.studies;

const CONCEPT_CARDS = `/* Concept notes read like study cards. */
.markdown-preview-view h1, .cm-s-obsidian .HyperMD-header-1 {
    border-bottom: 3px solid var(--interactive-accent);
    padding-bottom: 0.2em;
}
.markdown-preview-view h2, .cm-s-obsidian .HyperMD-header-2 {
    border-left: 4px solid var(--interactive-accent);
    padding-left: 0.5em;
}
.markdown-preview-view pre {
    border-radius: 8px;
}
`;

const CORE_PLUGINS = [
  "file-explorer", "global-search", "switcher", "graph", "backlink", "outgoing-link",
  "tag-pane", "properties", "page-preview", "templates", "note-composer",
  "command-palette", "editor-status", "starred", "outline", "word-count",
  "random-note", "bookmarks", "canvas", "bases",
];

export const VAULT_TYPES = Object.keys(GRAPH_FOLDERS);

function graph(type) {
  return {
    "collapse-filter": false,
    search: GRAPH_HIDDEN[type].map((f) => `-file:"${f}"`).join(" "),
    showTags: false,
    showAttachments: false,
    hideUnresolved: true,
    showOrphans: true,
    colorGroups: GRAPH_FOLDERS[type].map((folder, i) => ({
      query: `path:${folder}/`,
      color: { a: 1, rgb: COLORS[i % COLORS.length] },
    })),
    showArrow: true,
    nodeSizeMultiplier: 1.5,
    lineSizeMultiplier: 1.2,
  };
}

const json = (value) => JSON.stringify(value, null, 2) + "\n";

/** Every file under .obsidian/ that a new vault of this type needs. */
export function vaultConfigFiles(type, spellcheckLanguage = "en-US") {
  return [
    {
      path: ".obsidian/app.json",
      content: json({
        alwaysUpdateLinks: true,
        newLinkFormat: "shortest",
        useMarkdownLinks: false,
        attachmentFolderPath: "Assets",
        showLineNumber: true,
        readableLineLength: true,
        livePreview: true,
        defaultViewMode: "preview",
        spellcheck: true,
        spellcheckLanguages: [spellcheckLanguage],
      }),
    },
    {
      path: ".obsidian/appearance.json",
      content: json({ baseFontSize: 16, theme: "obsidian", enabledCssSnippets: ["callouts", "concept-cards"] }),
    },
    { path: ".obsidian/core-plugins.json", content: json(CORE_PLUGINS) },
    {
      path: ".obsidian/page-preview.json",
      content: json({ internalLinkOverride: true, pageLinkOverride: true, imageIndicator: true }),
    },
    { path: ".obsidian/graph.json", content: json(graph(type)) },
    { path: ".obsidian/snippets/callouts.css", content: CALLOUTS[type] },
    { path: ".obsidian/snippets/concept-cards.css", content: CONCEPT_CARDS },
  ];
}

export function folderList(type) {
  return GRAPH_FOLDERS[type];
}
