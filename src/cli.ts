#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { scan } from "./commands/scan.js";
import { view } from "./commands/view.js";
import { mcp } from "./commands/mcp.js";
import { hook } from "./commands/hook.js";
import { publish } from "./commands/publish.js";
import { login } from "./commands/login.js";
import { commentsPull, commentsAdd, commentsReply } from "./commands/comments.js";
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
  .action(async (path: string, opts: { api?: string; name?: string }) => {
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
  .option("--to-issues", "open each unresolved comment as a GitHub issue (requires gh)", false)
  .action(async (path: string, opts: { open?: boolean; slug?: string; api?: string; toIssues?: boolean }) => {
    await commentsPull(path, opts);
    await maybeNotifyUpdate();
  });
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
