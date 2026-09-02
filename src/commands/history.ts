import { listHistory, type MapVersion, type HistoryStats } from "../core/history.js";
import { relTime, stamp } from "../core/time.js";

/**
 * CLI surface of a code map's publish history (alkahest ADR-023). `alkahest history` prints the
 * timeline of publishes — when each happened, the count deltas, and which screens/resources were
 * added/removed — so you can see what a publish actually changed. Talks to the `map-versions` edge
 * function through src/core/history.ts; nothing is stored locally.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

const failMessage = (code: string | undefined, message: string | undefined): string => {
  const known: Record<string, string> = {
    no_slug: `${message ?? "Which project?"}\n  Pass --slug <slug> — 'alkahest projects' lists them, or set ALKAHEST_PROJECT.`,
    invalid_token: "✗ Token invalid or revoked. Run 'alkahest login' again.",
    forbidden: "✗ Only a project member or collaborator can view history.",
    not_found: `✗ ${message ?? "Not found."}`,
  };
  return known[code ?? ""] ?? `history failed: ${message}`;
};

/** "14 screens, 28 transitions" — omit zero counts (resources/calls are often 0). */
function statsLine(s: HistoryStats | null): string {
  if (!s) return "—";
  const parts = [`${s.screens} screens`];
  if (s.resources) parts.push(`${s.resources} resources`);
  if (s.transitions) parts.push(`${s.transitions} transitions`);
  if (s.calls) parts.push(`${s.calls} calls`);
  return parts.join(", ");
}

/** Count deltas vs the previous (older) version, e.g. "+3 screens, +8 transitions". */
function deltaLine(cur: HistoryStats | null, prev: HistoryStats | null): string {
  if (!cur || !prev) return "";
  const keys: (keyof HistoryStats)[] = ["screens", "resources", "transitions", "calls"];
  const bits: string[] = [];
  for (const k of keys) {
    const d = (cur[k] ?? 0) - (prev[k] ?? 0);
    if (d !== 0) bits.push(`${d > 0 ? "+" : ""}${d} ${k}`);
  }
  return bits.join(", ");
}

export interface HistoryOptions { api?: string; slug?: string; map?: string; limit?: string; }

export async function history(path: string, options: HistoryOptions): Promise<void> {
  const limit = options.limit ? Math.max(1, parseInt(options.limit, 10) || 50) : undefined;
  const res = await listHistory(path, { api: options.api, slug: options.slug, map: options.map, limit });
  if (!res.ok || !res.versions) return die(failMessage(res.code, res.message));

  const vs = res.versions; // newest first
  if (vs.length === 0) {
    console.log(`[alkahest] no publishes recorded for ${res.slug}/${res.mapSlug} yet.`);
    return;
  }

  const head = `${res.slug}/${res.mapSlug}`;
  console.log(`[alkahest] ${head} — ${vs.length} publish${vs.length === 1 ? "" : "es"}${limit && vs.length >= limit ? " (most recent)" : ""}:`);
  vs.forEach((v: MapVersion, i: number) => {
    const prev = vs[i + 1]; // the older one
    const delta = deltaLine(v.stats, prev?.stats ?? null);
    const tail = i === vs.length - 1 ? "  (earliest shown)" : delta ? `  ${delta}` : "  (no count change)";
    console.log(`\n  ${stamp(v.createdAt)}  ·  ${relTime(v.createdAt)}`);
    console.log(`    ${statsLine(v.stats)}${tail}`);
    // Node-level changes (added/removed screens & resources), when recorded.
    for (const kind of ["screens", "resources"] as const) {
      const d = v.diff?.[kind];
      if (!d) continue;
      for (const a of d.added) console.log(`      + ${a.label || a.id}`);
      for (const r of d.removed) console.log(`      − ${r.label || r.id}`);
      if (d.more && (d.more.added || d.more.removed)) {
        console.log(`      … +${d.more.added} more added, ${d.more.removed} more removed`);
      }
    }
  });
}
