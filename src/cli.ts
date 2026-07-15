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
import { issuesPull, issuesAdd, issuesStatus, issuesDone, issuesLink, issuesMap, issuesRm, issuesPriority, issuesDue, issuesAssign, issuesComments, issuesComment, issuesReply, issuesResolveComment } from "./commands/issues.js";
import { notesAdd, notesImport, notesLink, notesList, notesMap, notesShow, notesUpdate } from "./commands/notes.js";
import { mapsList, mapsCreate } from "./commands/maps.js";
import { projects } from "./commands/projects.js";
import { history } from "./commands/history.js";
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
  .option("--map <slug>", "which code map to publish to (a project can hold several)")
  .action(async (path: string, opts: { api?: string; name?: string; slug?: string; map?: string }) => {
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
  .option("--map <slug>", "restrict to one code map's comments (defaults to this checkout's map)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action(async (path: string, opts: { open?: boolean; slug?: string; map?: string; api?: string }) => {
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
  .option("--map <slug>", "which code map the comment is on (defaults to this checkout's map)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((node: string, opts: { body?: string; slug?: string; map?: string; api?: string; path?: string }) => commentsAdd(node, opts));
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
  .option("--map <slug>", "restrict to one issue map within the project")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action(async (path: string, opts: { slug?: string; api?: string; map?: string }) => {
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
  .option("--map <slug>", "which issue map to add to (a project can hold several)")
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
  .command("map")
  .description("place an issue on an issue map, or take it off with --remove (maps are lenses over the issue pool; the issue is never deleted)")
  .argument("<id>", "issue id (from 'issues pull')")
  .option("--map <slug>", "target issue map (omit when the project has just one)")
  .option("--remove", "take the issue off the map instead of placing it", false)
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, opts: Parameters<typeof issuesMap>[1]) => issuesMap(id, opts));
issues
  .command("rm")
  .description("delete an issue (author or project owner only; its edges go with it)")
  .argument("<id>", "issue id")
  .option("--path <dir>", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, opts: { path?: string; api?: string }) => issuesRm(id, opts));
issues
  .command("comments")
  .description("read issue discussion threads — the decision channel (? = open question)")
  .option("--issue <id>", "restrict to one issue's thread")
  .option("--open", "only unresolved comments (decisions awaiting an answer)", false)
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((opts: { issue?: string; open?: boolean; path?: string; slug?: string; api?: string }) => issuesComments(opts));
issues
  .command("comment")
  .description("post a note on an issue, or a decision question with --question")
  .argument("<id>", "issue id (from 'issues pull')")
  .requiredOption("--body <text>", "comment text")
  .option("--question", "post as a decision question (blocks the issue until resolved)", false)
  .option("--mention <handle...>", "tag member(s) by name/handle — routes 'waiting on you' to them")
  .option("--path <dir>", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, opts: { body: string; question?: boolean; mention?: string[]; path?: string; api?: string }) => issuesComment(id, opts.body, opts));
issues
  .command("reply")
  .description("reply under an issue comment (id from 'issues comments')")
  .argument("<id>", "parent comment id")
  .requiredOption("--body <text>", "reply text")
  .option("--mention <handle...>", "tag member(s) by name/handle")
  .option("--path <dir>", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, opts: { body: string; mention?: string[]; path?: string; api?: string }) => issuesReply(id, opts.body, opts));
issues
  .command("resolve")
  .description("resolve a decision question (or reopen it with --reopen)")
  .argument("<id>", "comment id (from 'issues comments')")
  .option("--reopen", "reopen instead of resolving", false)
  .option("--path <dir>", "project path", ".")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((id: string, opts: { reopen?: boolean; path?: string; api?: string }) => issuesResolveComment(id, opts));

const notes = program
  .command("notes")
  .description("the hosted Note Map — markdown notes on a mindmap canvas (cloud ADR-017/027)");
notes
  .command("add")
  .description("create a note (a markdown document node; connect it on the canvas)")
  .argument("<title>", "note title")
  .option("--body <markdown>", "note body (markdown)")
  .option("--note-slug <slug>", "explicit note address (default: derived from the title)")
  .option("--folder <path>", "tree-sidebar path like 'raw/articles' (omit = unfiled)")
  .option("--parent <id>", "parent note — creates a child edge (parent → new)")
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--map <slug>", "which note map to add to (a project can hold several)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((title: string, opts: Parameters<typeof notesAdd>[1]) => notesAdd(title, opts));
notes
  .command("list")
  .description("list a note map's notes and links (--q to search title/slug/body)")
  .option("--q <text>", "filter notes by title/slug/body substring")
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--map <slug>", "restrict to one note map (default: all readable)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((opts: Parameters<typeof notesList>[0]) => notesList(opts));
notes
  .command("show")
  .description("one note in full: body, connections and backlinks")
  .argument("<note>", "note slug (or id)")
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--map <slug>", "which note map (a project can hold several)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((note: string, opts: Parameters<typeof notesShow>[1]) => notesShow(note, opts));
notes
  .command("link")
  .description("connect a note to another note, an issue, or a code-map node")
  .argument("<from>", "source note slug (or id)")
  .argument("<to>", "target: note slug (or id), issue:<uuid>, or code:s:…/code:r:…")
  .option("--style <style>", "note↔note only: arrow (default) | dotted | dashed")
  .option("--remove", "disconnect instead (all styles unless --style is given)", false)
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((from: string, to: string, opts: Parameters<typeof notesLink>[2]) => notesLink(from, to, opts));
notes
  .command("map")
  .description("place a pool note on a note map, or take it off with --remove (maps are lenses over the note pool; the note is never deleted)")
  .argument("<note>", "note slug (or id)")
  .option("--map <slug>", "target note map (omit when the project has just one)")
  .option("--remove", "take the note off the map instead of placing it", false)
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((note: string, opts: Parameters<typeof notesMap>[1]) => notesMap(note, opts));
notes
  .command("import")
  .description("import a folder of Obsidian-style .md files — one note per file, [[wikilinks]] become explicit edges (re-run to refresh: matches by title)")
  .argument("<dir>", "folder to walk recursively (dot-dirs like .obsidian are skipped)")
  .option("--map <slug>", "which note map the notes land on (omit when the project has just one)")
  .option("--exclude <name...>", "basenames to skip, e.g. --exclude index log")
  .option("--dry-run", "plan only: show what would be created/updated/linked", false)
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((dir: string, opts: Parameters<typeof notesImport>[1]) => notesImport(dir, opts));
notes
  .command("update")
  .description("edit a note in place — the wiki's upsert half (update, don't re-add)")
  .argument("<note>", "note slug (or id)")
  .option("--title <text>", "new title")
  .option("--body <markdown>", "new body (replaces)")
  .option("--clear-body", "clear the body", false)
  .option("--rename <slug>", "new note address (slug)")
  .option("--folder <path>", "move the note in the tree sidebar (path like 'raw/articles')")
  .option("--unfile", "clear the folder (back to the tree root)", false)
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--map <slug>", "which note map (a project can hold several)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((note: string, opts: Parameters<typeof notesUpdate>[1]) => notesUpdate(note, opts));

const maps = program
  .command("maps")
  .description("list or create the maps in a project (a project holds many code/issue/note maps)");
maps
  .command("list")
  .description("list the project's maps (code + issue + note) — handy when publish/issues report an ambiguous map")
  .argument("[path]", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--type <type>", "restrict to one type: code | issue | note")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action(async (path: string, opts: { slug?: string; type?: string; api?: string }) => {
    await mapsList(path, opts);
    await maybeNotifyUpdate();
  });
maps
  .command("create")
  .description("create a new map in the project")
  .argument("<slug>", "the new map's slug (lowercase letters, numbers, dashes)")
  .option("--type <type>", "code | issue | note (default: issue)")
  .option("--name <name>", "display name (defaults to the slug)")
  .option("--path <dir>", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action((slug: string, opts: { type?: string; name?: string; path?: string; slug?: string; api?: string }) =>
    mapsCreate(slug, opts));

program
  .command("projects")
  .description("list your account's workspaces & projects (recover a slug after a move, etc.)")
  .option("--json", "print the raw payload", false)
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action(async (opts: { json?: boolean; api?: string }) => {
    await projects(opts);
    await maybeNotifyUpdate();
  });

program
  .command("history")
  .description("a code map's publish history — when each publish happened and what changed")
  .argument("[path]", "project path", ".")
  .option("--slug <slug>", "project slug (defaults to the saved slug for this path)")
  .option("--map <slug>", "which code map (defaults to this checkout's / the oldest)")
  .option("--limit <n>", "max versions to show (default 50)")
  .option("--api <url>", "API base URL (or env ALKAHEST_API_URL)")
  .action(async (path: string, opts: { slug?: string; map?: string; limit?: string; api?: string }) => {
    await history(path, opts);
    await maybeNotifyUpdate();
  });

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
