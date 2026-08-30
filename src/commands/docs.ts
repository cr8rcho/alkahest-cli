import { createInterface } from "node:readline";
import { appendClaudeSnippet, docsInit, listPresets, type DocsInitResult } from "../core/docsInit.js";

/**
 * Printers for the docs-preset workflow (cloud ADR-083). Pure logic lives in
 * core/docsInit.ts; this layer owns stdout and the one file mutation that must stay
 * explicit — appending the snippet to CLAUDE.md.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

/** `alkahest presets` — list the registry (the same list every surface reads). */
export function presetsList(): void {
  const res = listPresets();
  if (!res.ok || !res.presets) return die(res.message ?? "could not read presets");
  console.log(`[alkahest] ${res.presets.length} preset(s):`);
  for (const p of res.presets) {
    console.log(`  ${p.id} — ${p.description}`);
    console.log(`    skills: ${p.skills.join(", ")} · maps: ${p.maps.join(", ")} · install: alkahest docs init --preset ${p.id}`);
  }
}

export interface DocsInitOptions {
  api?: string;
  slug?: string;
  path?: string;
  preset?: string;
  force?: boolean;
  /** Append the CLAUDE.md snippet without prompting. */
  claudeMd?: boolean;
}

const label: Record<string, string> = {
  installed: "installed", updated: "updated (--force)", skipped: "skipped — exists (yours; --force to overwrite)",
  created: "created", exists: "exists", failed: "FAILED", no_project: "no project bound — create later (web Maps page or MCP create_map)",
};

/** `alkahest docs init` — install a preset: skills + scaffold + script + maps + snippet. */
export async function docsInitCmd(options: DocsInitOptions): Promise<void> {
  const res = await docsInit(options.path || ".", {
    api: options.api, slug: options.slug, preset: options.preset, force: options.force,
  });
  if (!res.ok) return die(res.message ?? res.code ?? "init failed");

  console.log(`[alkahest] preset '${res.preset}':`);
  for (const s of res.skills ?? []) console.log(`  skill ${s.name}: ${label[s.action]}${s.message ? ` — ${s.message}` : ""}`);
  const made = (res.scaffold ?? []).filter((f) => f.action === "created").length;
  const kept = (res.scaffold ?? []).length - made;
  console.log(`  scaffold: ${made} file(s) created${kept ? `, ${kept} existing kept` : ""}`);
  for (const s of res.scripts ?? []) console.log(`  script ${s.dest}: ${label[s.action]}`);
  for (const m of res.maps ?? []) console.log(`  note map '${m.slug}': ${label[m.action]}${m.message ? ` — ${m.message}` : ""}`);
  if ((res.skills ?? []).some((s) => s.action === "failed") || (res.maps ?? []).some((m) => m.action === "failed")) {
    process.exitCode = 1;
  }

  await handleSnippet(options, res);
  printNextStep(res);
}

/** The CLAUDE.md half — prompt / append / print, per the caller's mode. */
async function handleSnippet(options: DocsInitOptions, res: DocsInitResult): Promise<void> {
  if (!res.snippet) return;
  if (res.snippetInstalled) {
    console.log("  CLAUDE.md: snippet already present — left untouched.");
    return;
  }
  const append = () => {
    const { file, created } = appendClaudeSnippet(options.path || ".", res.snippet!);
    console.log(`  CLAUDE.md: snippet ${created ? "written to new" : "appended to"} ${file}`);
  };
  if (options.claudeMd) return append();
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolveAns) =>
      rl.question("  Append the docs rules snippet to CLAUDE.md? [y/N] ", resolveAns));
    rl.close();
    if (/^y(es)?$/i.test(answer.trim())) return append();
    console.log("  Skipped. The snippet (add it to your agent rules yourself):\n");
    console.log(res.snippet);
    return;
  }
  console.log("  Non-interactive run — snippet NOT written (pass --claude-md to append). Snippet:\n");
  console.log(res.snippet);
}

/**
 * The hand-off. `docs init` only PLACES things — the first docs (and the map link that
 * makes the install visible) come from an agent session the user has to start. Ending on
 * the install report left that step unsaid, so the run looked like it produced nothing;
 * spell out the sentence to say, derived from the preset rather than hardcoded.
 */
function printNextStep(res: DocsInitResult): void {
  const skill = res.skills?.[0]?.name;
  const script = res.scripts?.[0]?.dest;
  if (!skill) return;
  const maps = (res.maps ?? []).map((m) => m.slug).join(" / ");

  console.log("\n[alkahest] Next — hand it to your agent:\n");
  console.log(`  "Read the ${skill} skill and write this repo's first as-built docs${
    script ? `,\n   then mirror them with node ${script}"` : '"'}`);
  console.log(
    `\n  It writes a small first pass (one system map, 2-3 core modules, ADR-001)${
      maps ? `, mirrors it\n  to the ${maps} note maps` : ""}, and hands you the map link.`,
  );
  if ((res.maps ?? []).some((m) => m.action === "no_project")) {
    console.log("\n  This folder isn't bound to a project yet — run `alkahest publish` first,");
    console.log("  or the mirror step has nowhere to land.");
  }
}
