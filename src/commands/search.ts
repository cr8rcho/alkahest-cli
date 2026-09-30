import { pullNotes } from "../core/notes.js";
import { pullIssues } from "../core/issues.js";
import { pullTasks } from "../core/tasks.js";

/**
 * `alkahest search <q>` — one query across notes, issues and tasks, the CLI twin of the MCP
 * `search` tool: three server-side filtered pulls (notes-pull / issues-pull / tasks-pull) merged
 * client-side. Notes and issues are project-scoped (the linked checkout, --slug, or
 * ALKAHEST_PROJECT); tasks are the account's, narrowed to that project when one resolves.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

export interface SearchOptions { path?: string; slug?: string; api?: string; json?: boolean }

export async function search(q: string, options: SearchOptions): Promise<void> {
  const root = options.path || ".";
  const common = { api: options.api, slug: options.slug };
  const [notesRes, issuesRes, tasksRes] = await Promise.all([
    pullNotes(root, { ...common, q, bodies: "excerpt" }),
    pullIssues(root, { ...common, q }),
    pullTasks(root, { api: options.api, project: options.slug, q, status: "all" }),
  ]);
  const notes = notesRes.ok && notesRes.maps
    ? notesRes.maps.flatMap((m) => m.notes.map((n) => ({ slug: n.slug, title: n.title, map: m.slug, folder: n.folder ?? null })))
    : null;
  const issues = issuesRes.ok && issuesRes.graph
    ? issuesRes.graph.issues.map((i) => ({ id: i.id, title: i.title, status: i.status, type: i.type, priority: i.priority ?? null }))
    : null;
  const tasks = tasksRes.ok && tasksRes.tasks
    ? tasksRes.tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, due_on: t.due_on, project: t.project?.slug ?? null }))
    : null;
  if (!notes && !issues && !tasks) {
    return die(`search failed: ${notesRes.message ?? issuesRes.message ?? tasksRes.message ?? "no surface answered"}`);
  }
  if (options.json) return console.log(JSON.stringify({ q, notes, issues, tasks }, null, 2));

  const unavailable = (r: { message?: string; code?: string }) => `  (unavailable: ${r.message ?? r.code ?? "?"})`;
  console.log(`[alkahest] notes — ${notes ? `${notes.length} match(es)` : "n/a"}`);
  if (!notes) console.log(unavailable(notesRes));
  for (const n of notes ?? []) console.log(`  ${n.map}/${n.slug}  ${n.title}${n.folder ? `  [${n.folder}]` : ""}`);
  console.log(`[alkahest] issues — ${issues ? `${issues.length} match(es)` : "n/a"}`);
  if (!issues) console.log(unavailable(issuesRes));
  for (const i of issues ?? []) console.log(`  ${i.id}  [${i.type}/${i.status}] ${i.title}`);
  console.log(`[alkahest] tasks — ${tasks ? `${tasks.length} match(es)` : "n/a"}`);
  if (!tasks) console.log(unavailable(tasksRes));
  for (const t of tasks ?? []) console.log(`  ${t.done ? "✓" : "·"} ${t.id}  ${t.title}${t.due_on ? `  (due ${t.due_on})` : ""}${t.project ? `  [${t.project}]` : ""}`);
}
