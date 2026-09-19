import { createInterface } from "node:readline";
import { appendClaudeSnippet, installPreset, listPresets, type InstallPresetResult } from "../core/presets.js";

/**
 * Printers for the preset workflow (cloud ADR-083 → ADR-106). Pure logic lives in
 * core/presets.ts; this layer owns stdout and the one file mutation that must stay
 * explicit — appending a snippet to CLAUDE.md. `alkahest preset list|install` are the
 * verbs; `alkahest presets` and `alkahest docs init` stay as aliases from the docs-only era.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

/** `alkahest preset list` — the registry (the same list every surface reads). */
export function presetsList(): void {
  const res = listPresets();
  if (!res.ok || !res.presets) return die(res.message ?? "could not read presets");
  console.log(`[alkahest] ${res.presets.length} preset(s):`);
  for (const p of res.presets) {
    console.log(`  ${p.id} — ${p.description}`);
    console.log(`    skills: ${p.skills.join(", ")} · maps: ${p.maps.join(", ")} · install: alkahest preset install ${p.id}`);
  }
}

export interface PresetInstallOptions {
  api?: string;
  slug?: string;
  path?: string;
  force?: boolean;
  /** Append the CLAUDE.md snippet without prompting. */
  claudeMd?: boolean;
}

const label: Record<string, string> = {
  installed: "installed", updated: "updated (--force)", skipped: "skipped — exists (yours; --force to overwrite)",
  created: "created", exists: "exists", failed: "FAILED", no_project: "no project bound — create later (web Maps page or MCP create_map)",
};

/** `alkahest preset install <id>` — skills + (scaffold + script + snippet when the preset has them) + maps. */
export async function presetInstallCmd(id: string, options: PresetInstallOptions): Promise<void> {
  const res = await installPreset(options.path || ".", {
    api: options.api, slug: options.slug, preset: id, force: options.force,
  });
  if (!res.ok) return die(res.message ?? res.code ?? "install failed");

  console.log(`[alkahest] preset '${res.preset}':`);
  for (const s of res.skills ?? []) console.log(`  skill ${s.name}: ${label[s.action]}${s.message ? ` — ${s.message}` : ""}`);
  // The repo half only prints when the preset has one — a wiki preset has no files to report.
  if (res.scaffold?.length) {
    const made = res.scaffold.filter((f) => f.action === "created").length;
    const kept = res.scaffold.length - made;
    console.log(`  scaffold: ${made} file(s) created${kept ? `, ${kept} existing kept` : ""}`);
  }
  for (const s of res.scripts ?? []) console.log(`  script ${s.dest}: ${label[s.action]}`);
  for (const m of res.maps ?? []) console.log(`  note map '${m.slug}': ${label[m.action]}${m.message ? ` — ${m.message}` : ""}`);
  if ((res.skills ?? []).some((s) => s.action === "failed") || (res.maps ?? []).some((m) => m.action === "failed")) {
    process.exitCode = 1;
  }

  await handleSnippet(options, res);
  printNextStep(res);
}

/** `alkahest docs init [--preset id]` — the original verb, kept as an alias. */
export async function docsInitCmd(options: PresetInstallOptions & { preset?: string }): Promise<void> {
  return presetInstallCmd(options.preset ?? "as-built", options);
}

/** The CLAUDE.md half — prompt / append / print, per the caller's mode. */
async function handleSnippet(options: PresetInstallOptions, res: InstallPresetResult): Promise<void> {
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
      rl.question("  Append the agent-rules snippet to CLAUDE.md? [y/N] ", resolveAns));
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
 * The hand-off. An install only PLACES things — the first pass (and the map link that
 * makes the install visible) comes from an agent session the user has to start. The
 * sentence to say is the preset's own (`handoff` in its manifest), so a wiki preset asks
 * for its first ingest and a docs preset for its first documentation pass.
 */
function printNextStep(res: InstallPresetResult): void {
  if (!res.handoff) return;
  const maps = (res.maps ?? []).map((m) => m.slug).join(" / ");

  console.log("\n[alkahest] Next — hand it to your agent:\n");
  console.log(`  "${res.handoff}"`);
  if (maps) console.log(`\n  It works against the ${maps} note map${res.maps!.length > 1 ? "s" : ""} and hands you the map link.`);
  if ((res.maps ?? []).some((m) => m.action === "no_project")) {
    console.log("\n  This folder isn't bound to a project yet — pass --slug <project>, or run `alkahest publish` first,");
    console.log("  or the note maps have nowhere to land.");
  }
}
