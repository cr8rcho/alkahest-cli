import { createInterface } from "node:readline";
import { appendClaudeSnippet, installPreset, listPresets, type InstallPresetResult } from "../core/presets.js";
import { updatePreset, type UpdateState } from "../core/presetUpdate.js";

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
  installed: "installed", updated: "updated (--force)", skipped: "skipped — exists (kept; `alkahest preset update` brings it up to date, keeping your edits)",
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

export interface PresetUpdateOptions {
  api?: string;
  path?: string;
  dryRun?: boolean;
  json?: boolean;
  adopt?: boolean;
}

const updateLabel: Record<UpdateState, string> = {
  current: "up to date",
  replaced: "updated",
  merged: "updated — your edits kept",
  merged_with_conflicts: "updated — some of your lines replaced (below)",
  diverged: "NOT updated — left as is",
  replaced_edits: "updated — now the preset's engine",
  created: "created",
  not_installed: "not installed",
  failed: "FAILED",
};

/**
 * `alkahest preset update [id]` (cloud ADR-108) — bring installed skills / script / snippet up
 * to the preset's current bodies. It always completes: where an edit and a preset change hit
 * the same lines the preset wins, and those replaced lines are printed so the agent (or the
 * person) can restore what was deliberate. `--dry-run` reports without writing.
 */
export async function presetUpdateCmd(id: string | undefined, options: PresetUpdateOptions): Promise<void> {
  const res = await updatePreset(options.path || ".", { api: options.api, preset: id, dryRun: options.dryRun, adopt: options.adopt });
  if (!res.ok || !res.presets) return die(res.message ?? res.code ?? "update failed");
  if (options.json) {
    console.log(JSON.stringify({ ok: true, dryRun: !!options.dryRun, presets: res.presets }, null, 2));
    if (res.presets.some((p) => p.items.some((i) => i.state === "failed"))) process.exitCode = 1;
    return;
  }
  if (!res.presets.length) {
    console.log("[alkahest] no preset is installed here (account skills or this repo) — nothing to update.");
    console.log("  Install one with `alkahest preset install <id>` (see `alkahest preset list`).");
    return;
  }

  const touchedFiles = new Set<string>();
  let replacedLines = false;
  const diverged: string[] = [];
  const reset: string[] = [];
  for (const p of res.presets) {
    console.log(`[alkahest] preset '${p.id}'${options.dryRun ? " (dry run — nothing written)" : ""}:`);
    for (const i of p.items) {
      if (i.state === "not_installed" && !id) continue;
      const from = i.from && i.state !== "current" ? ` (from ${i.from}${i.exactBase === false ? ", closest match to your copy" : ""})` : "";
      console.log(`  ${i.kind} ${i.name}: ${updateLabel[i.state]}${from}${i.message ? ` — ${i.message}` : ""}`);
      if (i.kind !== "skill" && ["replaced", "replaced_edits", "created", "merged", "merged_with_conflicts"].includes(i.state)) touchedFiles.add(i.name);
      if (i.state === "diverged" && !i.presetChange) reset.push(i.name);
      if (i.state === "diverged" && i.presetChange) {
        diverged.push(i.name);
        console.log("    The preset's change to apply to your version by hand:");
        for (const l of i.presetChange ?? []) console.log(`      ${l}`);
      }
      for (const c of i.conflicts ?? []) {
        replacedLines = true;
        console.log(`    at line ${c.line}:`);
        for (const l of c.local) console.log(`      - ${l}`);
        for (const l of c.preset) console.log(`      + ${l}`);
      }
    }
    if (p.changes.length) {
      console.log("  What changed in the preset:");
      for (const l of p.changes) console.log(`    ${l}`);
    }
    if (p.items.some((i) => i.state === "failed")) process.exitCode = 1;
  }
  if (options.dryRun) return;
  if (touchedFiles.size) console.log(`\n[alkahest] Review the repo changes: git diff ${[...touchedFiles].join(" ")}`);
  if (replacedLines) {
    console.log("[alkahest] Some of your lines were replaced by the preset's. If they were deliberate, hand it to your agent:");
    console.log('  "Review the lines alkahest preset update replaced and restore the ones that were our customizations."');
  }
  if (reset.length) {
    const cfg = res.presets.flatMap((p) => p.items).find((i) => i.kind === "script" && i.name.endsWith(".config.mjs"))?.name
      ?? "scripts/sync-docs-maps.config.mjs";
    console.log(`[alkahest] ${reset.join(", ")} kept — your sync works exactly as before. To move it onto the preset's engine (so later fixes arrive by themselves), hand it to your agent:`);
    console.log(`  "Move what our ${reset.join(", ")} does differently from the alkahest preset into ${cfg} (its comments list the keys), ` +
      "then run alkahest preset update again — it switches once the engine stages the same notes " +
      "(if our old script has no --stage-only, run alkahest preset update --adopt instead, then " +
      `node scripts/sync-docs-maps.mjs --dry-run and confirm it plans no new notes)."`);
  }
  if (diverged.length) {
    console.log(`[alkahest] ${diverged.join(", ")} ${diverged.length === 1 ? "was" : "were"} left untouched — still working as before, but without the preset's change. Hand it to your agent:`);
    console.log(`  "Apply the preset change alkahest preset update printed for ${diverged.join(", ")} to our version, keeping how ours works."`);
  }
}
