import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { checkForUpdate } from "../core/version.js";
import { repoPresetsBehind } from "../core/presetUpdate.js";

/**
 * Update the installed alkahest to the latest version.
 *
 * Latest-version detection asks the npm registry's `latest` dist-tag (see core/version.ts) —
 * npm is what the update actually installs, so it is the honest signal. The update mechanism
 * adapts to the install:
 *  - git checkout (`git clone` + `npm link`): `git pull` + rebuild in place.
 *  - npm global install (no .git): reinstall the latest from npm.
 *
 * `--check` only reports current-vs-latest and changes nothing.
 */
export interface UpdateOptions {
  check?: boolean;
}

export async function update(options: UpdateOptions = {}): Promise<void> {
  const require = createRequire(import.meta.url);
  const pkgRoot = dirname(require.resolve("../../package.json"));
  const pkgName = (require("../../package.json") as { name: string }).name;

  const { current, latest, behind, reachable } = await checkForUpdate();
  console.log(`[alkahest] current version ${current}`);
  if (latest && !behind) {
    console.log(`[alkahest] already up to date (latest on npm is ${latest}).`);
    await presetNudge();
    return;
  }
  if (latest) console.log(`[alkahest] update available: ${current} → ${latest}`);
  else if (!reachable) console.log(`[alkahest] (couldn't reach the npm registry to check the latest version — offline or proxied? Proceeding anyway.)`);
  else console.log(`[alkahest] (nothing published on npm to compare against.)`);

  if (options.check) return; // report-only

  if (!existsSync(join(pkgRoot, ".git"))) {
    console.log("[alkahest] update by reinstalling the latest from npm:");
    console.log(`  npm install -g ${pkgName}@latest`);
    console.log("[alkahest] then, in each repo that uses a preset: alkahest preset update  (brings its skills / script / CLAUDE.md snippet up to the new version)");
    return;
  }

  const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: pkgRoot, stdio: "inherit" });
  try {
    console.log("[alkahest] git pull…");
    run("git", ["pull", "--ff-only"]);
    console.log("[alkahest] npm install (rebuilds via prepare)…");
    run("npm", ["install"]);
  } catch (err) {
    console.error("[alkahest] update failed: " + (err instanceof Error ? err.message : String(err)));
    console.error(`  resolve it by hand in ${pkgRoot} (e.g. check 'git status'), then re-run.`);
    process.exitCode = 1;
    return;
  }
  console.log("[alkahest] done — restart the MCP server / reopen your tools to pick up the new version.");
  console.log("[alkahest] then, in each repo that uses a preset: alkahest preset update  (brings its skills / script / CLAUDE.md snippet up to the new version)");
}

/**
 * On an up-to-date CLI the package's preset bodies ARE the latest, so this repo's copies can be
 * judged right here (offline, repo files only — ADR-108). One line, only when something is behind.
 */
async function presetNudge(): Promise<void> {
  try {
    const behind = await repoPresetsBehind(".");
    if (behind.length) console.log(`[alkahest] this repo's ${behind.join(", ")} preset files are behind — run: alkahest preset update`);
  } catch { /* a nudge must never fail the command */ }
}
