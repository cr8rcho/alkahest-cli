#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { scan } from "./commands/scan.js";
import { view } from "./commands/view.js";
import { mcp } from "./commands/mcp.js";
import { hook } from "./commands/hook.js";
import { publish } from "./commands/publish.js";
import { login } from "./commands/login.js";
import { commentsPull, commentsAdd, commentsReply, commentsIssue } from "./commands/comments.js";
import { issuesPull, issuesAdd, issuesStatus, issuesDone, issuesLink, issuesRm, issuesPriority, issuesDue, issuesAssign } from "./commands/issues.js";
import { update } from "./commands/update.js";
import { maybeNotifyUpdate } from "./core/version.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("alkahest")
  .description("Screen-graph CLI that reverse-engineers a product from code (static analysis → product map)")
  .version(pkg.version);

program
  .command("scan")
  .description("Analyze a project → .alkahest/map.json + index.html (incremental by default)")
  .argument("[path]", "project path to analyze", ".")
  .option("--full", "ignore the baseline and rescan everything", false)
  .option("--open", "open the dashboard right after scanning", false)
  .action(async (path: string, opts: { full: boolean; open: boolean }) => {
    await scan(path, opts);
    await maybeNotifyUpdate();
  });

program
  .command("view")
  .description("open the .alkahest/ dashboard via a local server")
  .argument("[path]", "project path", ".")
  .action((path: string) => view(path));

program
  .command("login")
  .description("save your personal publish token (from the web app) so 'publish' can authenticate")
  .option("--token <token>", "alk_… token from the web app (Account → Create token)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((opts: { token?: string; api?: string }) => login(opts));

program
  .command("publish")
  .description("upload .alkahest/map.json to the hosted viewer → shareable link (no login to view)")
  .argument("[path]", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .option("--name <name>", "project name (first publish only)")
  .option("--slug <slug>", "update an existing project by slug (else resolved from the checkout)")
  .action(async (path: string, opts: { api?: string; name?: string; slug?: string }) => {
    await publish(path, opts);
    await maybeNotifyUpdate();
  });

const comments = program
  .command("comments")
  .description("work with comments left on this project's published map (hosted viewer)");
comments
  .command("pull")
  .description("pull map comments into .alkahest/comments.json for use during development")
  .argument("[path]", "project path", ".")
  .option("--open", "only unresolved comments", false)
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action(async (path: string, opts: { open?: boolean; slug?: string; api?: string }) => {
    await commentsPull(path, opts);
    await maybeNotifyUpdate();
  });
comments
  .command("issue")
  .description("file the given comments as ONE GitHub issue (requires gh) and link it back onto each")
  .argument("<ids...>", "comment ids to group into one issue (from 'comments pull')")
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .option("--title <title>", "issue title (else derived from the comments)")
  .option("--repo <owner/repo>", "target GitHub repo (else gh's default for the project's repo)")
  .option("--force", "file even if some selected comments are already linked to an issue", false)
  .action((ids: string[], opts: { path?: string; slug?: string; api?: string; title?: string; repo?: string; force?: boolean }) => commentsIssue(ids, opts));
comments
  .command("add")
  .description("post a new comment on a screen/resource of the published map")
  .argument("<node>", "screen id/route/title, resource id/path/label, or 'map'")
  .requiredOption("--body <text>", "comment text")
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((node: string, opts: { body?: string; slug?: string; api?: string; path?: string }) => commentsAdd(node, opts));
comments
  .command("reply")
  .description("reply to an existing comment (id from 'comments pull')")
  .argument("<id>", "parent comment id")
  .requiredOption("--body <text>", "reply text")
  .option("--path <dir>", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, opts: { body?: string; api?: string; path?: string }) => commentsReply(id, opts));

const issues = program
  .command("issues")
  .description("work with this project's Issue Map — a map-shaped issue tracker on the hosted viewer");
issues
  .command("pull")
  .description("pull the issue graph into .alkahest/issues.json and print it (▶ = actionable now)")
  .argument("[path]", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action(async (path: string, opts: { slug?: string; api?: string }) => {
    await issuesPull(path, opts);
    await maybeNotifyUpdate();
  });
issues
  .command("add")
  .description("create an issue (a node of the issue graph)")
  .argument("<title>", "issue title")
  .option("--type <type>", "node type from the project's issue config (default: task)")
  .option("--status <status>", "status from the project's issue config (default: todo)")
  .option("--body <markdown>", "issue body")
  .option("--priority <level>", "none | low | medium | high | urgent (default: none)")
  .option("--due <date>", "due date in YYYY-MM-DD")
  .option("--assignee <user-id>", "assign to a project member (user id)")
  .option("--parent <id>", "parent issue — creates a contains edge (epic → task)")
  .option("--target <key>", "code-map target: s:/r: node key, /route (planned screen), or a resource label")
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((title: string, opts: Parameters<typeof issuesAdd>[1]) => issuesAdd(title, opts));
issues
  .command("status")
  .description("move an issue to a status from the project's issue config")
  .argument("<id>", "issue id (from 'issues pull')")
  .argument("<status>", "new status id")
  .option("--path <dir>", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, status: string, opts: { path?: string; api?: string }) => issuesStatus(id, status, opts));
issues
  .command("priority")
  .description("set an issue's priority (none | low | medium | high | urgent)")
  .argument("<id>", "issue id (from 'issues pull')")
  .argument("<level>", "none | low | medium | high | urgent")
  .option("--path <dir>", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, level: string, opts: { path?: string; api?: string }) => issuesPriority(id, level, opts));
issues
  .command("due")
  .description("set or clear an issue's due date")
  .argument("<id>", "issue id (from 'issues pull')")
  .argument("<date>", "due date YYYY-MM-DD, or 'none' to clear")
  .option("--path <dir>", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, date: string, opts: { path?: string; api?: string }) => issuesDue(id, date, opts));
issues
  .command("assign")
  .description("assign an issue to a project member (or 'none' to clear)")
  .argument("<id>", "issue id (from 'issues pull')")
  .argument("<user>", "member user id, or 'none' to unassign")
  .option("--path <dir>", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, user: string, opts: { path?: string; api?: string }) => issuesAssign(id, user, opts));
issues
  .command("done")
  .description("mark an issue finished (moves it to the project's terminal status)")
  .argument("<id>", "issue id (from 'issues pull')")
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, opts: { path?: string; slug?: string; api?: string }) => issuesDone(id, opts));
issues
  .command("link")
  .description("connect two issues: <from> —kind→ <to> (blocks = from must finish first)")
  .argument("<from>", "issue id")
  .argument("<to>", "issue id")
  .option("--kind <kind>", "blocks | contains | relates", "blocks")
  .option("--remove", "remove the edge instead of adding it", false)
  .option("--path <dir>", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((from: string, to: string, opts: { kind?: string; remove?: boolean; path?: string; api?: string }) => issuesLink(from, to, opts));
issues
  .command("rm")
  .description("delete an issue (author or project owner only; its edges go with it)")
  .argument("<id>", "issue id")
  .option("--path <dir>", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, opts: { path?: string; api?: string }) => issuesRm(id, opts));

program
  .command("mcp")
  .description("run the MCP server over stdio (agents query the product map; no key)")
  .action(() => mcp());

program
  .command("hook")
  .description("install/remove git hooks — run scan on commit/merge (diff-driven refresh)")
  .argument("<action>", "install | uninstall")
  .action((action: string) => hook(action));

program
  .command("update")
  .description("update alkahest to the latest GitHub release (--check: only report)")
  .option("--check", "only report current vs latest, don't change anything", false)
  .action((opts: { check: boolean }) => update(opts));

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
