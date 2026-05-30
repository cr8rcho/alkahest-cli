import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runScan, loadOrScan } from "../core/pipeline.js";
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

  return server;
}

// ---------- helpers ----------

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
function json(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
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
