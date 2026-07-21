import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runScan, loadOrScan, loadMap } from "../core/pipeline.js";
import { emitMap, emitDashboard } from "../core/emit.js";
import { publishMap } from "../core/publish.js";
import { pullComments, resolveComment, enrichComments, postComment, resolveNode, fileCommentsIssue } from "../core/comments.js";
import {
  pullIssues,
  createIssue,
  updateIssue,
  deriveIssueStates,
  terminalStatuses,
  pullIssueComments,
  postIssueComment,
  resolveIssueComment,
  mapIssue,
} from "../core/issues.js";
import { createTask, pullTasks } from "../core/tasks.js";
import { createNote, editPropDefs, getNote, linkNotes, mapNote, pullNotes, updateNote } from "../core/notes.js";
import { listMaps, createMap } from "../core/maps.js";
import { listProjects } from "../core/listProjects.js";
import { listHistory } from "../core/history.js";
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
        map: z.string().optional().describe("Which code map to publish to (a project can hold several; omit when there's one). Passing a new slug creates that code map. List them with the maps tool."),
      },
    },
    async ({ path, name, slug, map }) => {
      const res = await publishMap(rootOf(path), { name, slug, mapSlug: map, source: "mcp" });
      if (!res.ok) {
        const hints: Record<string, string> = {
          no_map: "Run the scan tool first to build .alkahest/map.json.",
          no_token: "Set ALKAHEST_TOKEN in this MCP server's config (get a token at alkahest.app → Account).",
          no_api: "Set ALKAHEST_API_URL in this MCP server's config.",
          plan_limit: "Free plan project limit reached — upgrade to Pro for more.",
          invalid_token: "The publish token is invalid or revoked — create a new one at alkahest.app → Account.",
          client_too_old: "This alkahest is too old to publish — run 'alkahest update'.",
          ambiguous_map: "List the project's code maps with the maps tool, then call publish again with `map` set to one of them (or a new slug to create one).",
          ambiguous_project: "This checkout has no linked project and an existing one looks like it — do NOT create a duplicate. Pick a candidate's slug below (or use list_projects) and call publish again with `slug` set, or pass a deliberately new `name` to create a fresh project.",
        };
        const hint = hints[res.code ?? ""] ? ` ${hints[res.code ?? ""]}` : "";
        // Carry the structured map list (the edge function returns it) so the agent can pick without re-listing.
        const maps = res.maps?.length ? ` Maps: ${JSON.stringify(res.maps)}` : "";
        // Carry slug-less-publish candidates so the agent can re-publish with the right slug.
        const cands = res.candidates?.length
          ? ` Candidates: ${JSON.stringify(res.candidates.map((c) => ({ slug: c.slug, name: c.projectName, workspace: c.workspace, map: c.mapSlug })))}`
          : "";
        return text(`Publish failed (${res.code}): ${res.message}.${hint}${maps}${cands}`);
      }
      const v = await cachedUpdateStatus().catch(() => null);
      // Needs tail (cloud ADR-032): the server counts what's waiting on the token's user in this
      // project (unresolved decision questions + assigned issues). Surface it with an explicit
      // relay hint so agent-driven users hear about blocked decisions in their terminal.
      const waiting = (res.needs?.decisions ?? 0) + (res.needs?.assigned ?? 0);
      return json({
        ok: true,
        slug: res.slug,
        url: res.viewerUrl ?? res.mapUrl,
        created: res.created,
        ...(res.needs && waiting > 0
          ? {
              needs: res.needs,
              needsHint: `Tell the user: ${[
                res.needs.decisions > 0 ? `${res.needs.decisions} decision${res.needs.decisions === 1 ? "" : "s"}` : null,
                res.needs.assigned > 0 ? `${res.needs.assigned} assigned issue${res.needs.assigned === 1 ? "" : "s"}` : null,
              ].filter(Boolean).join(" and ")} waiting on them${res.needs.url ? ` at ${res.needs.url}` : ""}.`,
            }
          : {}),
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
    not_found: "Not found — list ids with the issues tool, or the project's issue maps with the maps tool.",
    ambiguous_map: "List the project's issue maps with the maps tool, then retry with `map` set to one (or create one with create_map).",
  };
  // `maps` (present on ambiguous_map / unknown-slug) is appended as JSON so the agent can pick a map
  // without a second round-trip to the maps tool.
  const issueFail = (what: string, code?: string, message?: string, maps?: { slug: string; name: string | null }[]) =>
    text(`${what} failed (${code}): ${message}.${issueHints[code ?? ""] ? " " + issueHints[code ?? ""] : ""}${maps?.length ? ` Maps: ${JSON.stringify(maps)}` : ""}`);

  server.registerTool(
    "issues",
    {
      title: "Issue Map graph",
      description:
        "Read this project's Issue Map: a dependency-first issue tracker drawn as a graph on the hosted viewer. " +
        "Returns issues (work items with per-project type/status), edges (blocks = dependency, contains = grouping, " +
        "relates), code-map links, and the project's issue_config (valid types/statuses). Each issue carries derived " +
        "state: done (terminal status), actionable (not done, nothing unfinished blocks it, and no open decision " +
        "question awaits an answer), and awaitingDecision (open_questions > 0) — use actionable issues to decide what " +
        "to work on next. When you hit a decision you need the user to make mid-task, post it with ask_issue (the issue " +
        "stops being actionable until they answer and you resolve_issue_question). Read the thread with issue_comments. " +
        "Needs a publish token and a published project.",
      inputSchema: {
        path: z.string().optional().describe("Project root (default: cwd)"),
        open: z.boolean().optional().describe("Only issues that are not done (default: false = all)"),
        map: z.string().optional().describe("Restrict to one issue map (a project can hold several; omit when there's one). List them with the maps tool."),
      },
    },
    async ({ path, open, map }) => {
      const res = await pullIssues(rootOf(path), { mapSlug: map });
      if (!res.ok || !res.graph) return issueFail("Read issues", res.code, res.message, res.maps);
      const states = deriveIssueStates(res.graph);
      const issues = res.graph.issues
        .map((i) => ({ ...i, ...states.get(i.id)! }))
        .filter((i) => !open || !i.done);
      return json({
        ok: true,
        slug: res.graph.slug,
        issue_config: res.graph.issue_config,
        // Members = @mention targets for ask_issue (route a decision to a specific person, ADR-020 §9).
        members: res.graph.members,
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
        map: z.string().optional().describe("Which issue map to add to (a project can hold several; omit when there's one). List them with the maps tool, or create one with create_map."),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ title, type, status, body, priority, due_on, assignee_id, parent_id, target, map, path }) => {
      const targetFields = target
        ? {
            target_kind: (target.startsWith("s:") || target.startsWith("r:") ? "node" : target.startsWith("/") ? "route" : "resource") as
              "node" | "route" | "resource",
            target_key: target,
          }
        : {};
      const res = await createIssue(rootOf(path), { title, type, status, body, priority, due_on, assignee_id, parent_id, mapSlug: map, ...targetFields });
      if (!res.ok || !res.issue) return issueFail("Add issue", res.code, res.message, res.maps);
      return json({ ok: true, issue: res.issue });
    },
  );

  // ---- tasks: the PERSONAL lightweight sibling of an issue — a private checklist item (ADR-049/050) ----
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Read your PERSONAL tasks (ADR-050) — a private checklist item (title + done + optional due, a project tag, " +
        "and free tags); only you see it. Use tasks for your own quick throughput and issues for shared/team work that " +
        "needs a thread/decision/code link. Returns open tasks by default (status:'all' includes done); pass `project` " +
        "(slug) to see only tasks tagged to it. Needs a publish token — no project or publish required.",
      inputSchema: {
        status: z.enum(["open", "all"]).optional().describe("open (default) = not done; all = include done"),
        project: z.string().optional().describe("Only tasks tagged to this project (slug)"),
        path: z.string().optional().describe("Project root (default: cwd — used only to find your token/API)"),
      },
    },
    async ({ status, project, path }) => {
      const res = await pullTasks(rootOf(path), { status, project });
      if (!res.ok || !res.tasks) return issueFail("List tasks", res.code, res.message);
      return json({ ok: true, count: res.tasks.length, tasks: res.tasks });
    },
  );

  server.registerTool(
    "add_task",
    {
      title: "Add a task",
      description:
        "Add a PERSONAL task to the token user's list (ADR-050) — a private checklist item (title + optional due, a " +
        "project tag, free tags). Only they see it; it shows in their home Tasks band + activity feed (chipped as the " +
        'agent). Reach for it when you spot small personal work ("remind me to X", "add a task to Y"). **No project or ' +
        "publish is required** — omit `project` for a personal Inbox task. For shared/team work that needs a thread, " +
        "decision, status, or code-map link, use add_issue instead (a task can be promoted to an issue later). Pass " +
        "`tags` for free labels and `dedup_key` to stay idempotent across re-scans. Needs a publish token.",
      inputSchema: {
        title: z.string().describe("Task title"),
        body: z.string().optional().describe("Optional markdown detail"),
        project: z.string().optional().describe("Tag the task to a project (slug). Omit for a personal Inbox task. (You must belong to its workspace.)"),
        workspace: z.string().optional().describe("Which workspace an Inbox task lives in (slug) — only needed with no project AND you belong to several workspaces"),
        tags: z.array(z.string()).optional().describe("Free personal labels, e.g. ['errand','urgent']"),
        due_on: z.string().optional().describe("Due date as YYYY-MM-DD"),
        assignee_id: z.string().optional().describe("Assign to a user id"),
        dedup_key: z.string().optional().describe("Stable key for idempotent re-posting (e.g. 'scan:<hash>')"),
        path: z.string().optional().describe("Project root (default: cwd — a linked checkout auto-tags its project)"),
      },
    },
    async ({ title, body, project, workspace, tags, due_on, assignee_id, dedup_key, path }) => {
      const res = await createTask(rootOf(path), { title, body, slug: project, workspace, tags, due_on, assignee_id, dedup_key });
      if (!res.ok || !res.task) {
        const wsHint = res.workspaces?.length ? ` Workspaces: ${JSON.stringify(res.workspaces)}` : "";
        return issueFail("Add task", res.code, `${res.message ?? ""}${wsHint}`);
      }
      return json({ ok: true, task: res.task });
    },
  );

  // ---- notes: the Note Map — markdown documents on a mindmap canvas (ADR-017/027) ----
  // Bodies are PLAIN markdown (ADR-028): never parsed for links. Connections are drawn on the
  // canvas by hand (a future tool may add explicit linking).
  server.registerTool(
    "notes",
    {
      title: "Note map graph",
      description:
        "Read this project's Note Map — markdown notes drawn as a mindmap on the hosted viewer. Returns each map's " +
        "notes (with per-map slug addresses) and its connections — explicit agent-drawn edges AND the [[wikilink]] references derived from bodies at read time (kind 'wikilink', derived:true). Bodies come back as EXCERPTS (first 240 chars, " +
        "body_more marks truncation) so listing a big wiki stays cheap — read one full document with get_note, or " +
        "pass full_bodies only when you truly need every document at once. Each map payload carries prop_defs — " +
        "the notebook's property schema (key/type/options); notes carry their props values (reserved key `tags`). " +
        "ALWAYS check this before add_note when " +
        "recording knowledge: if a note on the topic exists, update_note it instead of adding a near-duplicate. " +
        "`q` searches title/slug/FULL body server-side. Needs a publish token and a published project.",
      inputSchema: {
        path: z.string().optional().describe("Project root (default: cwd)"),
        q: z.string().optional().describe("Filter notes by title/slug/body substring (matches the full body)"),
        map: z.string().optional().describe("Restrict to one note map (default: all readable). List them with the maps tool."),
        full_bodies: z.boolean().optional().describe("Return complete bodies instead of 240-char excerpts (heavy on a big wiki)"),
      },
    },
    async ({ path, q, map, full_bodies }) => {
      const res = await pullNotes(rootOf(path), { mapSlug: map, q, bodies: full_bodies ? undefined : "excerpt" });
      if (!res.ok || !res.maps) return issueFail("Read notes", res.code, res.message, res.mapList);
      return json({ ok: true, project: res.project, count: res.maps.reduce((n, m) => n + m.notes.length, 0), maps: res.maps });
    },
  );

  server.registerTool(
    "get_note",
    {
      title: "Read one note",
      description:
        "One note in full: markdown body, outgoing connections and backlinks — explicit edges plus [[wikilink]] references derived from bodies at read time (kind 'wikilink'). Address by note slug " +
        "(see the notes tool), or uuid. Needs a publish token.",
      inputSchema: {
        note: z.string().describe("Note slug (or id)"),
        map: z.string().optional().describe("Which note map (omit when the slug is unique across maps)"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ note, map, path }) => {
      const res = await getNote(rootOf(path), { note, mapSlug: map });
      if (!res.ok || !res.note) return issueFail("Get note", res.code, res.message, res.mapList);
      const { ok: _ok, code: _code, message: _message, mapList: _ml, ...rest } = res;
      return json({ ok: true, ...rest });
    },
  );

  server.registerTool(
    "add_note",
    {
      title: "Add a note",
      description:
        "Create a note on this project's Note Map. Use it to record durable knowledge as you work — a policy decided " +
        "while closing an issue, a convention, a constraint — one topic per note, body as a markdown document. Check " +
        "the notes tool first: if a note on the topic exists, update_note it instead of adding a near-duplicate. " +
        "Connect it to other notes by writing [[Title]] refs in the body — the graph derives them at read time. If the " +
        "project has several note maps, pass `map`. Needs a publish token; owner or collaborator only.",
      inputSchema: {
        title: z.string().describe("Note title (the node label)"),
        body: z.string().optional().describe("Note body as a markdown document (details, context)"),
        note_slug: z.string().optional().describe("Explicit note address (default: derived from the title)"),
        folder: z.string().optional().describe("Tree-sidebar path like 'raw/articles' (omit = unfiled) — the web viewer's Obsidian-style tree groups by it"),
        props: z.record(z.any()).optional().describe("Notebook properties (flat key→value): reserved key `tags` = string array; other keys should match the map's schema (see prop_defs in the notes tool) — unknown keys are kept but show as unregistered"),
        map: z.string().optional().describe("Which note map to add to (a project can hold several; omit when there's one). List them with the maps tool, or create one with create_map."),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ title, body, note_slug, folder, props, map, path }) => {
      const res = await createNote(rootOf(path), { title, body, note_slug, folder, props, mapSlug: map });
      if (!res.ok || !res.note) return issueFail("Add note", res.code, res.message, res.maps);
      return json({ ok: true, note: res.note });
    },
  );

  server.registerTool(
    "link_notes",
    {
      title: "Link a note to an issue or a code-map node",
      description:
        "Connect a note to an ISSUE or a CODE-MAP node — cross links that record provenance and show in the " +
        "note's document view: to='issue:<uuid>' cites the issue a decision came out of (use it when a " +
        "completed issue's outcome is distilled into a note); to='code:s:<screen id>' / 'code:r:<resource id>' " +
        "ties the note to a code-map node (node ids come from the overview/scan tools). NOTE↔NOTE links are " +
        "NOT made here: write a [[Title]] ref into the note's body (update_note) — the graph derives it at " +
        "read time. remove=true disconnects instead. Needs a publish token; owner or collaborator only.",
      inputSchema: {
        from: z.string().describe("Source note slug (or id)"),
        to: z.string().describe("Target: 'issue:<uuid>', or 'code:s:…' / 'code:r:…'"),
        remove: z.boolean().optional().describe("true → disconnect from→to instead"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ from, to, remove, path }) => {
      const res = await linkNotes(rootOf(path), { from, to, remove });
      if (!res.ok) return issueFail(remove ? "Unlink notes" : "Link notes", res.code, res.message, res.maps);
      return json({ ok: true, ...(remove ? { removed: `${from} → ${to}` } : { linked: `${from} → ${to}` }) });
    },
  );

  server.registerTool(
    "map_note",
    {
      title: "Move a note to a note map",
      description:
        "MOVE an existing note to another note map. A note lives on exactly ONE map — the maps are separate " +
        "notebooks (e.g. an llm-wiki and a company-wiki), so this re-homes the note rather than adding a second " +
        "placement. Its folder path and layout carry along. Address the note by its project-unique slug (see the " +
        "notes tool). Needs a publish token; owner or collaborator only.",
      inputSchema: {
        note: z.string().describe("Note slug (or id)"),
        map: z.string().optional().describe("Target note map (a project can hold several; omit when there's one). List them with the maps tool."),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ note, map, path }) => {
      const res = await mapNote(rootOf(path), { noteRef: note, mapSlug: map });
      if (!res.ok) return issueFail("Move note", res.code, res.message, res.maps);
      return json({ ok: true, note: res.note, map: res.map });
    },
  );

  server.registerTool(
    "update_note",
    {
      title: "Update a note",
      description:
        "Edit a note in place — when knowledge on a topic evolves, update its note rather than adding a near-" +
        "duplicate. Replaces title and/or markdown body; new_slug renames the note's address; folder moves it in the tree sidebar; " +
        "props patches notebook properties. Address by note slug " +
        "(see the notes tool), or uuid. Also the DELETE verb: delete:true SOFT-deletes the note to the project's " +
        "Trash — restorable for 30 days, then purged — and requires `reason`, a one-line why shown to the user in " +
        "the Trash and the activity journal (write something meaningful like 'stale mirror, superseded by [[X]]', " +
        "not 'cleanup'). restore:true brings a trashed note back; edits to a trashed note fail with note_deleted " +
        "until restored. Note author or workspace owner/admin only for delete. Needs a publish token.",
      inputSchema: {
        note: z.string().describe("Note slug (or id) to edit"),
        title: z.string().optional().describe("New title"),
        body: z.string().optional().describe("New body as markdown (replaces the old one)"),
        new_slug: z.string().optional().describe("New note address (slug)"),
        folder: z.string().nullable().optional().describe("Tree-sidebar path like 'raw/articles'; null unfiles the note; omit = untouched"),
        props: z.record(z.any()).optional().describe("Notebook properties, SHALLOW-MERGED onto the note's current values — pass only the keys to change; a null value deletes that key; reserved key `tags` = string array"),
        delete: z.boolean().optional().describe("true → soft-delete the note to the project Trash (restorable for 30 days) instead of editing; requires `reason`"),
        reason: z.string().optional().describe("REQUIRED with delete (≤200 chars): a one-line reason the user sees in the Trash and the activity journal — say WHY the note should go, not just 'cleanup'"),
        restore: z.boolean().optional().describe("true → restore the note from the Trash (undoes a soft delete)"),
        map: z.string().optional().describe("Which note map (a project can hold several; omit when there's one)"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ note, title, body, new_slug, folder, props, delete: del, reason, restore, map, path }) => {
      const res = await updateNote(rootOf(path), { note, title, body, new_slug, folder, props, delete: del, reason, restore, mapSlug: map });
      const what = del ? "Delete note" : restore ? "Restore note" : "Update note";
      if (!res.ok) return issueFail(what, res.code, res.message, res.maps);
      if (res.deleted) {
        return json({
          ok: true, deleted: true, id: res.id, slug: res.noteSlug,
          ...(res.unchanged ? { unchanged: true } : {}),
          trash: "in the project Trash — restorable for 30 days (restore: true, or the web Trash view)",
        });
      }
      if (res.restored) return json({ ok: true, restored: true, note: res.note });
      if (!res.note) return issueFail(what, res.code, res.message, res.maps);
      return json({ ok: true, note: res.note });
    },
  );

  server.registerTool(
    "note_props",
    {
      title: "Edit note-map property schema",
      description:
        "Register or unregister a note map's property DEFINITIONS (key/type/options — the notebook's schema; " +
        "values ride notes.props). `define` adds definitions so the web shows typed rows instead of 'unregistered' " +
        "badges — same merge as `notes import` (unknown key inserts, same-type select/multi options union, type " +
        "mismatch skips). `remove` is the cleanup verb — drops the def row only, non-destructively (note VALUES " +
        "survive as 'unregistered'). Pass either or both. The reserved `tags` key is refused in both; unknown " +
        "remove keys are silent no-ops. See prop_defs in the notes tool for the current schema. Needs a publish token.",
      inputSchema: {
        define: z.array(z.object({
          key: z.string().describe("Property key (≤64 chars; `tags` is reserved)"),
          type: z.enum(["text", "select", "multi", "date", "number", "checkbox"]).describe("Property type"),
          options: z.array(z.string()).optional().describe("Shared option vocabulary — select/multi only"),
        })).optional().describe("Definitions to register/merge onto the note map's schema"),
        remove: z.array(z.string()).optional().describe("Property definition key(s) to unregister; note values are kept. Reserved key `tags` is refused."),
        map: z.string().optional().describe("Which note map (a project can hold several; omit when there's one)"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ define, remove, map, path }) => {
      if (!define?.length && !remove?.length) {
        return json({ ok: false, error: "bad_request", message: "Pass `define` (definitions to register) and/or `remove` (keys to unregister)." });
      }
      const res = await editPropDefs(rootOf(path), { defs: define, remove, mapSlug: map });
      if (!res.ok) return issueFail("Edit note props", res.code, res.message, res.maps);
      return json({ ok: true, added: res.added ?? 0, merged: res.merged ?? 0, removed: res.removed ?? 0, skipped: res.skipped ?? 0 });
    },
  );

  server.registerTool(
    "maps",
    {
      title: "List a project's maps",
      description:
        "List the maps in this published project. A project is a container of many maps (ADR-011): code maps " +
        "(published from a scan) and issue maps — each with a per-project slug, addressed at /p/:project/:map. Maps " +
        "are equal (no default), so when a project has several of a type the publish / add_issue / issues tools return " +
        "'ambiguous_map' — call this to see the slugs, then pass `map`. Needs a publish token and a published project.",
      inputSchema: {
        path: z.string().optional().describe("Project root (default: cwd)"),
        type: z.enum(["code", "issue", "note"]).optional().describe("Restrict to one type (default: all)"),
      },
    },
    async ({ path, type }) => {
      const res = await listMaps(rootOf(path), { type });
      if (!res.ok || !res.maps) return issueFail("List maps", res.code, res.message);
      return json({ ok: true, slug: res.slug, count: res.maps.length, maps: res.maps });
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List account projects & workspaces",
      description:
        "List every workspace and project this account's token can reach (ADR-022). Use it to find a project's slug — " +
        "e.g. to recover the right publish target after the local link was lost (a workspace move, a fresh clone, CI), " +
        "or before publishing to confirm which existing project to update instead of creating a duplicate. Each project " +
        "includes isOwner (only owned projects can be re-published/overwritten) and per-code-map fingerprints " +
        "(screens/resources counts) so you can match a local scan by structure. Needs a publish token; no project context.",
      inputSchema: {},
    },
    async () => {
      const res = await listProjects({});
      if (!res.ok || !res.projects) {
        const hint = res.code === "no_token" ? " Set ALKAHEST_TOKEN in this MCP server's config." : "";
        return text(`List projects failed (${res.code}): ${res.message}.${hint}`);
      }
      return json({
        ok: true,
        workspaces: res.workspaces ?? [],
        projects: res.projects.map((p) => ({
          slug: p.slug,
          name: p.name,
          workspace: p.workspace?.name ?? p.workspace?.slug ?? null,
          isOwner: p.isOwner,
          capability: p.capability,
          isPublic: p.isPublic,
          updatedAt: p.updatedAt,
          codeMaps: p.codeMaps.map((m) => ({ mapSlug: m.mapSlug, stats: m.stats, lastPublishedAt: m.lastPublishedAt })),
        })),
      });
    },
  );

  server.registerTool(
    "history",
    {
      title: "Code map publish history",
      description:
        "Show a code map's publish timeline (ADR-023) — when each publish happened, the screen/resource/" +
        "transition counts, and which nodes were added/removed since the previous publish. Use it to answer " +
        "'when did this last publish' and 'what changed' without diffing manually. Needs a publish token and a " +
        "published project; `map` picks the code map when the project has several (else the oldest).",
      inputSchema: {
        path: z.string().optional().describe("Project root (default: cwd)"),
        map: z.string().optional().describe("Which code map (default: this checkout's / the oldest)"),
        limit: z.number().optional().describe("Max versions (default 50)"),
      },
    },
    async ({ path, map, limit }) => {
      const res = await listHistory(rootOf(path), { map, limit });
      if (!res.ok || !res.versions) return issueFail("History", res.code, res.message);
      // Newest first; include count deltas vs the previous version so the agent needn't recompute.
      const vs = res.versions;
      return json({
        ok: true,
        slug: res.slug,
        mapSlug: res.mapSlug,
        count: vs.length,
        versions: vs.map((v, i) => {
          const prev = vs[i + 1]?.stats ?? null;
          const delta = v.stats && prev
            ? Object.fromEntries((["screens", "resources", "transitions", "calls"] as const)
                .map((k) => [k, (v.stats![k] ?? 0) - (prev[k] ?? 0)]).filter(([, d]) => d !== 0))
            : null;
          return { createdAt: v.createdAt, stats: v.stats, delta, diff: v.diff };
        }),
      });
    },
  );

  server.registerTool(
    "create_map",
    {
      title: "Create a map",
      description:
        "Create a new map in this project — a code map (a slot you later publish a scan into) or an issue map. Use it " +
        "when the user wants a separate map (e.g. a second issue map for a workstream), or after an 'ambiguous_map' " +
        "error when none of the existing maps fit. The slug is addressed at /p/:project/:slug. Needs a publish token; " +
        "owner or collaborator only.",
      inputSchema: {
        slug: z.string().describe("The new map's slug (lowercase letters, numbers, dashes; the server slugifies)"),
        type: z.enum(["code", "issue", "note"]).optional().describe("Map type (default: issue)"),
        name: z.string().optional().describe("Display name (defaults to the slug)"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ slug, type, name, path }) => {
      const res = await createMap(rootOf(path), { mapSlug: slug, type, mapName: name });
      if (!res.ok || !res.map) return issueFail("Create map", res.code, res.message);
      return json({ ok: true, map: res.map });
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

  server.registerTool(
    "map_issue",
    {
      title: "Place an issue on / off an issue map",
      description:
        "Place an existing issue onto an issue map (issue maps are lenses over the project's issue pool — an issue " +
        "can appear on several maps at once), or take it off with remove:true. The issue itself is never deleted — " +
        "membership only changes which maps show it. Adding is idempotent. Use it to compose per-workstream issue " +
        "maps. Needs a publish token; owner or collaborator only.",
      inputSchema: {
        issue: z.string().describe("Issue id (from the issues tool)"),
        map: z.string().optional().describe("Which issue map (a project can hold several; omit when there's one). List them with the maps tool."),
        remove: z.boolean().optional().describe("true → take the issue off the map (the issue itself is never deleted)"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ issue, map, remove, path }) => {
      const res = await mapIssue(rootOf(path), { issueId: issue, mapSlug: map, remove });
      if (!res.ok) return issueFail(remove ? "Unmap issue" : "Map issue", res.code, res.message, res.maps);
      return json({ ok: true, issue: res.issue, map: res.map, member: res.member });
    },
  );

  // ---- issue discussion thread: the decision channel (ADR-020) ----
  server.registerTool(
    "issue_comments",
    {
      title: "Read an issue's discussion",
      description:
        "Read the discussion thread on this project's issues — the decision channel where you ask the user questions " +
        "mid-task and they answer (ADR-020). Each comment has a kind (question = a decision you need, answer = the " +
        "user's reply, result = a completion summary, note), a resolved flag (a question with resolved=false is still " +
        "awaiting an answer), and parent_id for replies. Pass `issue` to read one issue's thread, or `open` to see only " +
        "unresolved comments across the project (the decisions waiting on the user). Needs a publish token.",
      inputSchema: {
        issue: z.string().optional().describe("Restrict to one issue's thread (issue id from the issues tool)"),
        open: z.boolean().optional().describe("Only unresolved comments — the decisions still awaiting an answer (default: false)"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ issue, open, path }) => {
      const res = await pullIssueComments(rootOf(path), { issue, open });
      if (!res.ok || !res.comments) return issueFail("Read issue comments", res.code, res.message);
      return json({ ok: true, count: res.comments.length, comments: res.comments });
    },
  );

  server.registerTool(
    "ask_issue",
    {
      title: "Ask the user a decision on an issue",
      description:
        "Post a decision QUESTION on an issue and stop — this is how you escalate a choice to the user mid-task " +
        "(ADR-020). It posts a kind='question' comment on the issue's thread, which makes the issue stop being " +
        "actionable until the user answers and the question is resolved. Use it whenever you hit a fork the user should " +
        "decide (A vs B, an ambiguous requirement, a risky change). State the options clearly in `body`. With multiple " +
        "people, `mention` the member(s) who should decide (their name from the issues tool's `members`, or just their " +
        "handle) — it then surfaces as 'waiting on you' for exactly them, not the whole team. Re-read with issue_comments " +
        "to pick up the answer, then resolve_issue_question to close it and continue. Needs a publish token.",
      inputSchema: {
        issue: z.string().describe("Issue id to ask about (from the issues tool)"),
        body: z.string().describe("The question / decision needed — lay out the options so the user can just pick one"),
        mention: z.array(z.string()).optional().describe("Member(s) who should decide — names/handles from the issues tool's `members` (also write @name in body). Routes 'waiting on you' to them."),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ issue, body, mention, path }) => {
      const res = await postIssueComment(rootOf(path), { issue_id: issue, body, kind: "question", mention });
      if (!res.ok || !res.comment) return issueFail("Ask issue", res.code, res.message);
      return json({ ok: true, comment: res.comment, note: "Question posted — the issue is now awaiting the user's decision. Re-check with issue_comments, then resolve_issue_question once answered." });
    },
  );

  server.registerTool(
    "reply_issue",
    {
      title: "Reply on an issue thread",
      description:
        "Post a reply or a note on an issue's discussion thread (ADR-020). Reply under a comment with `parent` (e.g. to " +
        "acknowledge the user's decision or add follow-up), or start a top-level note with `issue`. Defaults to kind " +
        "'answer' for a reply and 'note' otherwise; pass `kind` to override. For a completion summary, prefer " +
        "complete_issue. Needs a publish token.",
      inputSchema: {
        issue: z.string().optional().describe("Issue id for a top-level note (omit when replying)"),
        parent: z.string().optional().describe("Comment id to reply under (inherits the issue)"),
        body: z.string().describe("Comment body (markdown)"),
        kind: z.enum(["note", "question", "answer", "result"]).optional().describe("Override the comment kind"),
        mention: z.array(z.string()).optional().describe("Member(s) to tag — names/handles from the issues tool's `members`"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ issue, parent, body, kind, mention, path }) => {
      const res = await postIssueComment(rootOf(path), { issue_id: issue, parent, body, kind, mention });
      if (!res.ok || !res.comment) return issueFail("Reply on issue", res.code, res.message);
      return json({ ok: true, comment: res.comment });
    },
  );

  server.registerTool(
    "resolve_issue_question",
    {
      title: "Resolve an issue question",
      description:
        "Mark a decision question on an issue's thread resolved (or reopen it with resolved=false) — the 'decision " +
        "closed' signal (ADR-020). Resolve a question once the user has answered and you've captured the decision; the " +
        "issue becomes actionable again. Only the comment author or the project owner can toggle it. Needs a publish token.",
      inputSchema: {
        id: z.string().describe("Comment id of the question (from issue_comments)"),
        resolved: z.boolean().optional().describe("false to reopen (default: true)"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ id, resolved, path }) => {
      const res = await resolveIssueComment(rootOf(path), { id, resolved });
      if (!res.ok) return issueFail("Resolve question", res.code, res.message);
      return json({ ok: true, id: res.id, resolved: res.resolved });
    },
  );

  server.registerTool(
    "complete_issue",
    {
      title: "Complete an issue with a result",
      description:
        "Finish an issue: move it to a terminal status AND leave a result summary on its thread, in one step (ADR-020 " +
        "layer 3). This is the right way to close work — the status flip paints progress onto the map, and the result " +
        "comment records WHAT you did and why for the human history (don't just silently flip status). After this, run " +
        "scan + publish so the code map reflects your changes; the publish stamps this issue with the map version that " +
        "shipped it. Needs a publish token.",
      inputSchema: {
        id: z.string().describe("Issue id to complete (from the issues tool)"),
        result: z.string().describe("What you did / the outcome — recorded as a 'result' comment on the issue"),
        status: z.string().optional().describe("Terminal status id from issue_config (default: the first terminal status, usually 'done')"),
        path: z.string().optional().describe("Project root (default: cwd)"),
      },
    },
    async ({ id, result, status, path }) => {
      const root = rootOf(path);
      // Resolve the terminal status to move to (explicit, else the project's first terminal status).
      let target = status;
      if (!target) {
        const g = await pullIssues(root, {});
        if (!g.ok || !g.graph) return issueFail("Complete issue", g.code, g.message, g.maps);
        const terminal = [...terminalStatuses(g.graph.issue_config)];
        if (!terminal.length) return text("Complete issue failed: this project's issue_config has no terminal status. Set one, or use update_issue with an explicit status.");
        target = terminal[0];
      }
      const upd = await updateIssue(root, { id, set: { status: target } });
      if (!upd.ok) return issueFail("Complete issue", upd.code, upd.message);
      const cmt = await postIssueComment(root, { issue_id: id, body: result, kind: "result" });
      if (!cmt.ok) return issueFail("Complete issue (result note)", cmt.code, cmt.message);
      return json({
        ok: true,
        issue: upd.issue,
        result: cmt.comment,
        note: "Done + result recorded. Now run scan + publish so the code map reflects the change — publish stamps this issue with the shipping map version.",
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
