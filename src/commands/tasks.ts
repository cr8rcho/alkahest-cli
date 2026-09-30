import { pullTasks } from "../core/tasks.js";

/**
 * `alkahest tasks list` — the account's personal tasks (cloud ADR-049), read-only from the CLI.
 * Tasks are captured on the phone/web and processed by an agent (MCP list_tasks & co.); the
 * shell verb exists to answer "what's waiting on me" without opening the app. Writes stay on
 * MCP/web.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

export interface TasksListOptions { path?: string; project?: string; q?: string; all?: boolean; api?: string; json?: boolean }

export async function tasksList(options: TasksListOptions): Promise<void> {
  const res = await pullTasks(options.path || ".", {
    api: options.api, project: options.project, q: options.q, status: options.all ? "all" : "open",
  });
  if (!res.ok || !res.tasks) {
    const hints: Record<string, string> = {
      invalid_token: "✗ Token invalid or revoked. Run 'alkahest login' again.",
      no_token: "✗ No API token — run 'alkahest login' first.",
    };
    return die(hints[res.code ?? ""] ?? `tasks list failed: ${res.message}`);
  }
  if (options.json) return console.log(JSON.stringify(res.tasks, null, 2));
  if (!res.tasks.length) return console.log(`[alkahest] no ${options.all ? "" : "open "}tasks${options.project ? ` for ${options.project}` : ""}.`);
  console.log(`[alkahest] ${res.tasks.length} task(s)`);
  for (const t of res.tasks) {
    const flags = [
      t.pending_notes ? `${t.pending_notes} pending note(s)` : "",
      t.open_questions ? `${t.open_questions} open question(s)` : "",
      t.note_mode ? `note:${t.note_mode}` : "",
    ].filter(Boolean).join(", ");
    console.log(`  ${t.done ? "✓" : "·"} ${t.id}  ${t.title}${t.due_on ? `  (due ${t.due_on})` : ""}${t.project ? `  [${t.project.slug}]` : ""}${flags ? `  — ${flags}` : ""}`);
  }
}
