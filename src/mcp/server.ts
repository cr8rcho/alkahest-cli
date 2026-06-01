import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runScan, loadOrScan, loadMap } from "../core/pipeline.js";
import { emitMap, emitDashboard } from "../core/emit.js";
import { publishMap } from "../core/publish.js";
import type { ProductMap, Screen } from "../core/types.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/**
 * MCP server that lets agents (Claude Code/Codex/Cursor) query the product map (ALKAHEST.md §7).
 * No LLM key required — reasoning is done by the calling agent. Tools provide only deterministic structure.
 * Default target is the server's working directory (cwd). Each tool's `path` can point to a different project.
 */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "alkahest", version: pkg.version });
  const rootOf = (path?: string) => resolve(path ?? process.cwd());

  server.registerTool(
    "scan",
    {
      title: "Scan project",
      description:
        "Statically analyze a React/Next project to create/update a product map (.alkahest/map.json + dashboard). " +
        "Extracts screens, transitions between screens, and the API/data calls each screen makes. Returns a result summary (counts).",
      inputSchema: { path: z.string().optional().describe("Project root (default: cwd)") },
    },
    async ({ path }) => {
      const result = runScan(rootOf(path));
      if (!result) return text("No screens found. Only Next app-router (page.* under app/ or src/app/) is supported.");
      const m = result.map;
      return json({
        framework: m.meta.framework,
        router: m.meta.router,
        screens: m.screens.length,
        resources: m.resources.length,
        transitions: m.transitions.length,
        calls: m.calls.length,
        mapPath: result.outFile,
      });
    },
  );

  server.registerTool(
    "overview",
    {
      title: "Product map overview",
      description:
        "Full product map overview: list of screens (route/title/feature count) and list of resources (label/number of calling screens). " +
        "Auto-scans if map.json is missing. Call this first to grasp the product structure at a glance.",
      inputSchema: { path: z.string().optional() },
    },
    async ({ path }) => {
      const map = loadOrScan(rootOf(path));
      if (!map) return text("No screens, or unsupported project.");
      return json({
        framework: map.meta.framework,
        router: map.meta.router,
        screens: map.screens.map((s) => ({
          id: s.id,
          route: s.route,
          title: s.title,
          features: s.features.length,
          navigatesTo: map.transitions.filter((t) => t.from === s.id).length,
          calls: map.calls.filter((c) => c.from === s.id).length,
        })),
        resources: map.resources.map((r) => ({
          id: r.id,
          label: r.label,
          calledByScreens: new Set(map.calls.filter((c) => c.to === r.id).map((c) => c.from)).size,
        })),
      });
    },
  );

  server.registerTool(
    "get_screen",
    {
      title: "Screen detail",
      description:
        "Full structure of one screen: UI features, outgoing/incoming transitions, called resources (API/data), components, and source location. " +
        "The agent can use this data to write a summary or PRD itself. Specify the screen by id/route/title.",
      inputSchema: { screen: z.string().describe("screen id / route / title"), path: z.string().optional() },
    },
    async ({ screen, path }) => {
      const map = loadOrScan(rootOf(path));
      if (!map) return text("No screens, or unsupported project.");
      const s = matchScreen(map, screen);
      if (!s) return text(`Screen not found: ${screen}`);
      return json(screenDetail(map, s));
    },
  );

  server.registerTool(
    "who_calls",
    {
      title: "Resource callers (impact)",
      description:
        "Returns the screens that call a specific resource (API endpoint/data). For understanding data dependencies and change impact. " +
        "Specify the resource by id ('GET /api/orders') or a path fragment ('/api/orders').",
      inputSchema: { resource: z.string(), path: z.string().optional() },
    },
    async ({ resource, path }) => {
      const map = loadOrScan(rootOf(path));
      if (!map) return text("No screens, or unsupported project.");
      const q = resource.toLowerCase();
      const matched = map.resources.filter(
        (r) => r.id.toLowerCase() === q || (r.path ?? "").toLowerCase().includes(q) || r.label.toLowerCase().includes(q),
      );
      return json(
        matched.map((r) => ({
          resource: r.label,
          callers: map.calls
            .filter((c) => c.to === r.id)
            .map((c) => ({ screen: c.from, via: c.trigger, loc: c.loc })),
        })),
      );
    },
  );

  // ---- write-back tools: the agent saves its prose into map.json so the dashboard shows it ----

  server.registerTool(
    "set_summary",
    {
      title: "Set screen summary",
      description:
        "Save a one-line, PM-friendly summary ('what the user does here') onto a screen in map.json, " +
        "then re-emit the dashboard so it appears in the screen's panel. Write the summary yourself from get_screen data.",
      inputSchema: {
        screen: z.string().describe("screen id / route / title"),
        summary: z.string().describe("a 1-2 sentence summary in the user's language"),
        path: z.string().optional(),
      },
    },
    async ({ screen, summary, path }) => writeField(rootOf(path), screen, (s) => { s.summary = summary; }),
  );

  server.registerTool(
    "set_prd",
    {
      title: "Set screen PRD",
      description:
        "Save a PRD/requirements markdown onto a screen in map.json, then re-emit the dashboard so it appears " +
        "in the screen's panel (rendered). Write the PRD yourself from get_screen / who_calls data.",
      inputSchema: {
        screen: z.string().describe("screen id / route / title"),
        prd: z.string().describe("PRD/requirements as markdown"),
        path: z.string().optional(),
      },
    },
    async ({ screen, prd, path }) => writeField(rootOf(path), screen, (s) => { s.prd = prd; }),
  );

  // ---- publish: upload the map to the hosted viewer for a shareable link ----

  server.registerTool(
    "publish",
    {
      title: "Publish to hosted viewer",
      description:
        "Upload this project's product map (.alkahest/map.json) to the hosted viewer (alkahest.app) and return a " +
        "shareable link anyone can open — no install, no login to view. Only map.json is uploaded; source code never " +
        "leaves the machine. Run 'scan' first if the map is missing. Auth uses a publish token from the ALKAHEST_TOKEN " +
        "env var (set it in this server's MCP config) or a prior 'alkahest login'.",
      inputSchema: {
        path: z.string().optional().describe("Project root (default: cwd)"),
        name: z.string().optional().describe("Project name for the link (first publish only; defaults to folder name)"),
      },
    },
    async ({ path, name }) => {
      const res = await publishMap(rootOf(path), { name, source: "mcp" });
      if (!res.ok) {
        const hints: Record<string, string> = {
          no_map: "Run the scan tool first to build .alkahest/map.json.",
          no_token: "Set ALKAHEST_TOKEN in this MCP server's config (get a token at alkahest.app → Account).",
          no_api: "Set ALKAHEST_API_URL in this MCP server's config.",
          plan_limit: "Free plan project limit reached — upgrade to Pro for more.",
          invalid_token: "The publish token is invalid or revoked — create a new one at alkahest.app → Account.",
          client_too_old: "This alkahest is too old to publish — run 'alkahest update'.",
        };
        const hint = hints[res.code ?? ""] ? ` ${hints[res.code ?? ""]}` : "";
        return text(`Publish failed (${res.code}): ${res.message}.${hint}`);
      }
      return json({
        ok: true,
        slug: res.slug,
        url: res.viewerUrl ?? res.mapUrl,
        created: res.created,
        ...(res.warning ? { warning: res.warning } : {}),
      });
    },
  );

  return server;
}

// ---------- helpers ----------

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
function json(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

/** Load map.json, mutate the matched screen, then re-emit map.json + dashboard. */
function writeField(root: string, screenArg: string, mutate: (s: Screen) => void) {
  const map = loadMap(root);
  if (!map) return text("No map.json found — run scan first.");
  const s = matchScreen(map, screenArg);
  if (!s) return text(`Screen not found: ${screenArg}`);
  mutate(s);
  emitMap(root, map);
  emitDashboard(root, map);
  return text(`Saved to ${s.id}. Dashboard updated.`);
}

function matchScreen(map: ProductMap, arg: string): Screen | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/^\/+|\/+$/g, "");
  const t = norm(arg);
  return map.screens.find((s) => norm(s.id) === t || norm(s.route) === t || norm(s.title) === t);
}

function screenDetail(map: ProductMap, s: Screen) {
  const resourceLabel = (id: string) => map.resources.find((r) => r.id === id)?.label ?? id;
  return {
    id: s.id,
    route: s.route,
    title: s.title,
    sourceFile: s.sourceFile,
    summary: s.summary || null,
    prd: s.prd || null,
    features: s.features,
    components: s.components,
    navigatesTo: map.transitions
      .filter((t) => t.from === s.id)
      .map((t) => ({ to: t.to ?? t.rawTarget ?? "(unresolved)", via: t.trigger, loc: t.loc })),
    navigatedFrom: map.transitions
      .filter((t) => t.to === s.id)
      .map((t) => ({ from: t.from, via: t.trigger, loc: t.loc })),
    calls: map.calls
      .filter((c) => c.from === s.id)
      .map((c) => ({ resource: c.to ? resourceLabel(c.to) : c.rawTarget ?? "(unresolved)", via: c.trigger, loc: c.loc })),
  };
}
