import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUTPUT_DIR } from "../core/emit.js";
import {
  pullIssues, createIssue, updateIssue, deriveIssueStates, terminalStatuses,
  type IssueGraph, type IssueEdge,
} from "../core/issues.js";

/**
 * CLI surface of the hosted Issue Map (cloud ADR-004). All subcommands talk to the
 * issues-* edge functions through src/core/issues.ts; nothing is stored locally
 * except the `pull` snapshot (.alkahest/issues.json), which travels with the checkout
 * like comments.json does.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

const failMessage = (code: string | undefined, message: string | undefined, action: string): string => {
  const known: Record<string, string> = {
    invalid_token: "✗ Token invalid or revoked. Run 'alkahest login' again.",
    forbidden: "✗ Only the project owner or a collaborator can do this.",
    not_found: `✗ ${message ?? "Not found."}`,
    no_slug: message ?? "No published map for this project yet.",
  };
  return known[code ?? ""] ?? `${action} failed: ${message}`;
};

export interface IssuesPullOptions { api?: string; slug?: string; }

export async function issuesPull(path: string, options: IssuesPullOptions): Promise<void> {
  const res = await pullIssues(path, options);
  if (!res.ok || !res.graph) return die(failMessage(res.code, res.message, "issues pull"));
  const graph = res.graph;
  const states = deriveIssueStates(graph);
  const open = graph.issues.filter((i) => !states.get(i.id)?.done);
  const actionable = open.filter((i) => states.get(i.id)?.actionable);

  const dir = join(res.root ?? path, OUTPUT_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "issues.json"),
    JSON.stringify({ ...graph, pulledAt: new Date().toISOString() }, null, 2) + "\n",
  );

  console.log(`[alkahest] pulled ${graph.issues.length} issue${graph.issues.length === 1 ? "" : "s"} on ${graph.slug}` +
    ` (${open.length} open, ${actionable.length} actionable) → ${OUTPUT_DIR}/issues.json`);
  for (const i of graph.issues) {
    const st = states.get(i.id)!;
    const mark = st.done ? "✓" : st.actionable ? "▶" : "⏳";
    const blocked = st.blockedBy.length ? `  (blocked by ${st.blockedBy.length})` : "";
    console.log(`  ${mark} [${i.type}/${i.status}] ${i.title}  ${i.id}${blocked}`);
  }
}

export interface IssuesAddOptions {
  api?: string; slug?: string; path?: string;
  type?: string; status?: string; body?: string;
  parent?: string; target?: string;
}

/** `--target` infers the kind: s:/r: prefix = existing node, leading '/' = planned route, else resource label. */
const inferTarget = (target: string): { target_kind: "node" | "route" | "resource"; target_key: string } => ({
  target_kind: target.startsWith("s:") || target.startsWith("r:") ? "node" : target.startsWith("/") ? "route" : "resource",
  target_key: target,
});

export async function issuesAdd(title: string, options: IssuesAddOptions): Promise<void> {
  const res = await createIssue(options.path || ".", {
    api: options.api, slug: options.slug,
    title, type: options.type, status: options.status, body: options.body,
    parent_id: options.parent,
    ...(options.target ? inferTarget(options.target) : {}),
  });
  if (!res.ok || !res.issue) return die(failMessage(res.code, res.message, "issues add"));
  console.log(`[alkahest] created [${res.issue.type}/${res.issue.status}] ${res.issue.title} — id ${res.issue.id}`);
}

export interface IssuesWriteOptions { api?: string; slug?: string; path?: string; }

export async function issuesStatus(id: string, status: string, options: IssuesWriteOptions): Promise<void> {
  const res = await updateIssue(options.path || ".", { api: options.api, id, set: { status } });
  if (!res.ok || !res.issue) return die(failMessage(res.code, res.message, "issues status"));
  console.log(`[alkahest] ${res.issue.title} → ${res.issue.status}`);
}

/** Move an issue to the project's (first) terminal status — "I finished this". */
export async function issuesDone(id: string, options: IssuesWriteOptions): Promise<void> {
  const pulled = await pullIssues(options.path || ".", { api: options.api, slug: options.slug });
  if (!pulled.ok || !pulled.graph) return die(failMessage(pulled.code, pulled.message, "issues done"));
  const terminal = [...terminalStatuses(pulled.graph.issue_config)];
  if (!terminal.length) return die("✗ No terminal status in this project's issue config — use 'issues status' instead.");
  await issuesStatus(id, terminal[0], options);
}

export interface IssuesLinkOptions extends IssuesWriteOptions { kind?: string; remove?: boolean; }

export async function issuesLink(from: string, to: string, options: IssuesLinkOptions): Promise<void> {
  const kind = (options.kind ?? "blocks") as IssueEdge["kind"];
  const edge = [{ to, kind }];
  const res = await updateIssue(options.path || ".", {
    api: options.api, id: from,
    ...(options.remove ? { remove_edges: edge } : { add_edges: edge }),
  });
  if (!res.ok) return die(failMessage(res.code, res.message, "issues link"));
  console.log(`[alkahest] ${options.remove ? "removed" : "linked"}: ${from} —${kind}→ ${to}`);
}

export async function issuesRm(id: string, options: IssuesWriteOptions): Promise<void> {
  const res = await updateIssue(options.path || ".", { api: options.api, id, delete: true });
  if (!res.ok) return die(failMessage(res.code, res.message, "issues rm"));
  console.log(`[alkahest] deleted issue ${id}`);
}

export { type IssueGraph };
