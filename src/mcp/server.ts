import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runScan, loadOrScan, loadMap } from "../core/pipeline.js";
import { emitMap, emitDashboard } from "../core/emit.js";
import { publishMap } from "../core/publish.js";
import { pullComments, resolveComment, enrichComments, postComment, resolveNode, fileCommentsIssue } from "../core/comments.js";
import { pullIssues, createIssue, updateIssue, deriveIssueStates } from "../core/issues.js";
import { findProjectRoot } from "../core/project.js";
import { checkForUpdate, cachedUpdateStatus } from "../core/version.js";
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
        slug: z.string().optional().describe("Update an existing project by slug (else resolved from the checkout/creds)"),
      },
    },
    async ({ path, name, slug }) => {
      const res = await publishMap(rootOf(path), { name, slug, source: "mcp" });
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
      const v = await cachedUpdateStatus().catch(() => null);
      return json({
        ok: true,
        slug: res.slug,
        url: res.viewerUrl ?? res.mapUrl,
        created: res.created,
        ...(v?.behind
          ? { updateAvailable: `${v.current} → ${v.latest}`, updateHint: "Tell the user to run: alkahest update" }
          : {}),
      });
    },
  );

  // ---- check_version: let the agent tell the user whether to update ----

  server.registerTool(
    "check_version",
    {
      title: "Check for alkahest updates",
      description:
        "Report the installed alkahest version vs the latest GitHub release, so you can tell the user whether their " +
        "alkahest is current. If behind, tell them to run 'alkahest update' — you can't update through MCP (the CLI " +
        "updates itself and this MCP server must be restarted to pick it up). No project access; just a version check.",
      inputSchema: {},
    },
    async () => {
      const s = await checkForUpdate();
      return json({
        current: s.current,
        latest: s.latest,
        behind: s.behind,
        action: s.behind
          ? "Out of date — tell the user to run: alkahest update (then restart this MCP server)."
          : s.latest
            ? "Up to date."
            : "No published GitHub release to compare against yet.",
      });
    },
  );

  // ---- comments: read map comments and act on them in-editor ----

  server.registerTool(
    "comments",
    {
      title: "Map comments",
      description:
        "List the comments people left on this project's PUBLISHED map (hosted viewer). Each comment is joined to its " +
        "node's source location (screen → sourceFile/route/title, resource → path/label) so you can open the right file " +
        "and address it. Use this to drive development from feedback: read open comments, edit the code, then call " +
        "resolve_comment. Needs a publish token (ALKAHEST_TOKEN in this server's config, or a prior 'alkahest login') " +
        "and the project must have been published.",
      inputSchema: {
        path: z.string().optional().describe("Project root (default: cwd)"),
        open: z.boolean().optional().describe("Only unresolved comments (default: false = all)"),
      },
    },
    async ({ path, open }) => {
      const root = rootOf(path);
      const res = await pullComments(root, { open });
      if (!res.ok) {
        const hints: Record<string, string> = {
          no_token: "Set ALKAHEST_TOKEN in this MCP server's config (token from alkahest.app → Account).",
          no_api: "Set ALKAHEST_API_URL in this MCP server's config.",
          no_slug: "This project hasn't been published yet — run the publish tool first.",
          invalid_token: "The publish token is invalid or revoked — create a new one at alkahest.app → Account.",
          not_found: "No accessible project for this slug.",
        };
        const hint = hints[res.code ?? ""] ? ` ${hints[res.code ?? ""]}` : "";
        return text(`Couldn't read comments (${res.code}): ${res.message}.${hint}`);
      }
      const map = loadMap(res.root ?? root);
      const comments = map ? enrichComments(res.comments ?? [], map) : (res.comments ?? []);
      return json({ ok: true, slug: res.slug, count: comments.length, comments });
    },
  );

  server.registerTool(
    "resolve_comment",
    {
      title: "Resolve a map comment",
      description:
        "Mark a map comment resolved after you've addressed it (or reopen it with resolved:false). Pass the comment id " +
        "from the comments tool. Only the comment author or the project owner can change it. Needs a publish token.",
      inputSchema: {
        id: z.string().describe("Comment id (from the comments tool)"),
        resolved: z.boolean().optional().describe("true (default) to resolve, false to reopen"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ id, resolved, path }) => {
      const res = await resolveComment(rootOf(path), id, resolved === undefined ? true : resolved);
      if (!res.ok) {
        const hints: Record<string, string> = {
          no_token: "Set ALKAHEST_TOKEN in this MCP server's config.",
          forbidden: "Only the comment author or project owner can resolve it.",
          not_found: "No comment with that id.",
        };
        const hint = hints[res.code ?? ""] ? ` ${hints[res.code ?? ""]}` : "";
        return text(`Resolve failed (${res.code}): ${res.message}.${hint}`);
      }
      return json({ ok: true, id: res.id, resolved: res.resolved });
    },
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add a map comment",
      description:
        "Leave a NEW comment on a node of this project's published map. Specify the node by id/route/title (a screen) " +
        "or id/path/label (a resource/endpoint), or 'map' for the whole map. Use this to record feedback or a finding " +
        "while working. Needs a publish token; you must be the project owner or a collaborator.",
      inputSchema: {
        node: z.string().describe("screen id/route/title, resource id/path/label, or 'map'"),
        body: z.string().describe("the comment text"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ node, body, path }) => {
      const root = findProjectRoot(rootOf(path));
      const map = loadOrScan(root);
      if (!map) return text("No map for this project — run the scan/publish tools first.");
      const n = resolveNode(map, node);
      if (!n) return text(`No node matches '${node}'. Use the overview tool to list screens/resources.`);
      const res = await postComment(root, { node_key: n.node_key, anchor_kind: n.anchor_kind, anchor_label: n.anchor_label, body });
      if (!res.ok) {
        const hints: Record<string, string> = {
          no_token: "Set ALKAHEST_TOKEN in this MCP server's config.",
          no_slug: "Publish this project first (publish tool).",
          forbidden: "Only the project owner or a collaborator can comment.",
        };
        return text(`Add comment failed (${res.code}): ${res.message}.${hints[res.code ?? ""] ? " " + hints[res.code ?? ""] : ""}`);
      }
      return json({ ok: true, id: res.comment?.id, node_key: n.node_key, anchor_label: n.anchor_label });
    },
  );

  server.registerTool(
    "reply_comment",
    {
      title: "Reply to a map comment",
      description:
        "Post a reply under an existing comment (use the comment id from the comments tool) — e.g. to note that you've " +
        "addressed it. The reply inherits the parent's node/anchor. Needs a publish token; owner or collaborator only.",
      inputSchema: {
        id: z.string().describe("parent comment id (from the comments tool)"),
        body: z.string().describe("the reply text"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ id, body, path }) => {
      const res = await postComment(rootOf(path), { parent_id: id, body });
      if (!res.ok) {
        const hints: Record<string, string> = {
          no_token: "Set ALKAHEST_TOKEN in this MCP server's config.",
          not_found: "No comment with that id (parent).",
          forbidden: "Only the project owner or a collaborator can comment.",
        };
        return text(`Reply failed (${res.code}): ${res.message}.${hints[res.code ?? ""] ? " " + hints[res.code ?? ""] : ""}`);
      }
      return json({ ok: true, id: res.comment?.id, parent_id: id });
    },
  );

  server.registerTool(
    "comment_to_issue",
    {
      title: "File map comments as a GitHub issue",
      description:
        "Group one or more map comments (ids from the comments tool) into a SINGLE GitHub issue and link it back onto each. " +
        "Creates the issue with the local `gh` CLI (must be installed and authenticated; it runs in the project's git repo), " +
        "then records the issue URL on the comments so the hosted viewer shows a 'tracked' badge. Use this to turn feedback " +
        "into tracked work. Needs a publish token; owner or collaborator only. Pass force:true to re-file comments that are " +
        "already linked to an issue (creates a new one).",
      inputSchema: {
        ids: z.array(z.string()).min(1).describe("Comment ids to group into one issue (from the comments tool)"),
        path: z.string().optional().describe("Project root (default: cwd)"),
        title: z.string().optional().describe("Issue title (else derived from the comments)"),
        repo: z.string().optional().describe("Target GitHub repo owner/repo (else gh's default for the repo)"),
        force: z.boolean().optional().describe("File even if some selected comments are already tracked"),
      },
    },
    async ({ ids, path, title, repo, force }) => {
      const res = await fileCommentsIssue(rootOf(path), ids, { title, repo, force });
      if (!res.ok) {
        const hints: Record<string, string> = {
          no_token: "Set ALKAHEST_TOKEN in this MCP server's config.",
          no_slug: "Publish this project first (publish tool).",
          already_tracked: "Some comments already have an issue — pass force:true to file a new one.",
          gh_failed: "Install and authenticate the GitHub CLI (`gh auth login`) for this repo.",
          forbidden: "Only the project owner or a collaborator can file issues.",
          not_found: "One or more ids don't exist — list them with the comments tool.",
        };
        return text(`File issue failed (${res.code}): ${res.message}.${hints[res.code ?? ""] ? " " + hints[res.code ?? ""] : ""}`);
      }
      return json({ ok: true, issue_url: res.issue_url, ids: res.ids, title: res.title });
    },
  );

  // ---- issues: the Issue Map — a map-shaped issue tracker on the hosted viewer ----

  const issueHints: Record<string, string> = {
    no_token: "Set ALKAHEST_TOKEN in this MCP server's config (token from alkahest.app → Account).",
    no_api: "Set ALKAHEST_API_URL in this MCP server's config.",
    no_slug: "This project hasn't been published yet — run the publish tool first.",
    invalid_token: "The publish token is invalid or revoked — create a new one at alkahest.app → Account.",
    forbidden: "Only the project owner or a collaborator can write issues.",
    not_found: "Not found — list ids with the issues tool.",
  };
  const issueFail = (what: string, code?: string, message?: string) =>
    text(`${what} failed (${code}): ${message}.${issueHints[code ?? ""] ? " " + issueHints[code ?? ""] : ""}`);

  server.registerTool(
    "issues",
    {
      title: "Issue Map graph",
      description:
        "Read this project's Issue Map: a dependency-first issue tracker drawn as a graph on the hosted viewer. " +
        "Returns issues (work items with per-project type/status), edges (blocks = dependency, contains = grouping, " +
        "relates), code-map links, and the project's issue_config (valid types/statuses). Each issue carries derived " +
        "state: done (terminal status) and actionable (not done, nothing unfinished blocks it) — use actionable issues " +
        "to decide what to work on next. Needs a publish token and a published project.",
      inputSchema: {
        path: z.string().optional().describe("Project root (default: cwd)"),
        open: z.boolean().optional().describe("Only issues that are not done (default: false = all)"),
      },
    },
    async ({ path, open }) => {
      const res = await pullIssues(rootOf(path), {});
      if (!res.ok || !res.graph) return issueFail("Read issues", res.code, res.message);
      const states = deriveIssueStates(res.graph);
      const issues = res.graph.issues
        .map((i) => ({ ...i, ...states.get(i.id)! }))
        .filter((i) => !open || !i.done);
      return json({
        ok: true,
        slug: res.graph.slug,
        issue_config: res.graph.issue_config,
        count: issues.length,
        issues,
        edges: res.graph.edges,
        links: res.graph.links,
      });
    },
  );

  server.registerTool(
    "add_issue",
    {
      title: "Add an issue",
      description:
        "Create a node on this project's Issue Map. Use it while planning with the user: each work item becomes an " +
        "issue, parent_id groups it under an epic (contains edge), and target ties it to the code map — pass an " +
        "existing node key ('s:…'/'r:…'), or a planned route ('/orders/refund') for a screen that doesn't exist yet " +
        "(it shows as a ghost node and auto-converges when a scan finds the real screen). type/status must come from " +
        "the project's issue_config (see the issues tool). Needs a publish token; owner or collaborator only.",
      inputSchema: {
        title: z.string().describe("Issue title"),
        type: z.string().optional().describe("Node type from issue_config (default: task)"),
        status: z.string().optional().describe("Status from issue_config (default: todo)"),
        body: z.string().optional().describe("Issue body as markdown (requirements, context)"),
        priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional().describe("Priority (default: none)"),
        due_on: z.string().optional().describe("Due date as YYYY-MM-DD"),
        assignee_id: z.string().optional().describe("Assign to a project member (user id)"),
        parent_id: z.string().optional().describe("Parent issue id — creates a contains edge (epic → task)"),
        target: z.string().optional().describe("Code-map target: 's:…'/'r:…' node key, '/route' (planned screen), or a resource label"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ title, type, status, body, priority, due_on, assignee_id, parent_id, target, path }) => {
      const targetFields = target
        ? {
            target_kind: (target.startsWith("s:") || target.startsWith("r:") ? "node" : target.startsWith("/") ? "route" : "resource") as
              "node" | "route" | "resource",
            target_key: target,
          }
        : {};
      const res = await createIssue(rootOf(path), { title, type, status, body, priority, due_on, assignee_id, parent_id, ...targetFields });
      if (!res.ok || !res.issue) return issueFail("Add issue", res.code, res.message);
      return json({ ok: true, issue: res.issue });
    },
  );

  server.registerTool(
    "update_issue",
    {
      title: "Update an issue",
      description:
        "Mutate an Issue Map node: move its status (e.g. to 'done' when you finish the work — this is how progress " +
        "gets painted onto the map), edit title/body/type, set its priority or due date, set or clear its code-map target, or delete it " +
        "(delete: author/owner only). Statuses/types must come from the project's issue_config. Needs a publish token.",
      inputSchema: {
        id: z.string().describe("Issue id (from the issues tool)"),
        status: z.string().optional().describe("New status from issue_config"),
        title: z.string().optional(),
        body: z.string().optional().describe("New body markdown"),
        type: z.string().optional().describe("New node type from issue_config"),
        priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional().describe("New priority"),
        due_on: z.string().optional().describe("New due date YYYY-MM-DD; pass '' to clear"),
        assignee_id: z.string().optional().describe("Assign to a project member (user id); pass '' to unassign"),
        target: z.string().optional().describe("New code-map target ('s:…'/'r:…'/'/route'/resource label); pass '' to clear"),
        delete: z.boolean().optional().describe("Delete the issue instead of updating it"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ id, status, title, body, type, priority, due_on, assignee_id, target, delete: del, path }) => {
      const set: Record<string, unknown> = {};
      if (status !== undefined) set.status = status;
      if (title !== undefined) set.title = title;
      if (body !== undefined) set.body = body;
      if (type !== undefined) set.type = type;
      if (priority !== undefined) set.priority = priority;
      if (due_on !== undefined) set.due_on = due_on === "" ? null : due_on;
      if (assignee_id !== undefined) set.assignee_id = assignee_id === "" ? null : assignee_id;
      if (target !== undefined) {
        if (target === "") Object.assign(set, { target_kind: null, target_key: null });
        else {
          set.target_kind = target.startsWith("s:") || target.startsWith("r:") ? "node" : target.startsWith("/") ? "route" : "resource";
          set.target_key = target;
        }
      }
      const res = await updateIssue(rootOf(path), { id, ...(del ? { delete: true } : { set }) });
      if (!res.ok) return issueFail("Update issue", res.code, res.message);
      return json(res.deleted ? { ok: true, deleted: true, id } : { ok: true, issue: res.issue });
    },
  );

  server.registerTool(
    "link_issues",
    {
      title: "Link two issues",
      description:
        "Add or remove an edge between two issues on the Issue Map: from —kind→ to. kind 'blocks' means `from` must " +
        "finish before `to` can start (the dependency arrows that make the map readable), 'contains' groups (epic → " +
        "task), 'relates' is a loose association. Needs a publish token; owner or collaborator only.",
      inputSchema: {
        from: z.string().describe("Issue id the edge starts at"),
        to: z.string().describe("Issue id the edge points to"),
        kind: z.enum(["blocks", "contains", "relates"]).optional().describe("Edge kind (default: blocks)"),
        remove: z.boolean().optional().describe("Remove the edge instead of adding it"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ from, to, kind, remove, path }) => {
      const edge = [{ to, kind: kind ?? ("blocks" as const) }];
      const res = await updateIssue(rootOf(path), { id: from, ...(remove ? { remove_edges: edge } : { add_edges: edge }) });
      if (!res.ok) return issueFail("Link issues", res.code, res.message);
      return json({ ok: true, from, to, kind: kind ?? "blocks", removed: Boolean(remove) });
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
