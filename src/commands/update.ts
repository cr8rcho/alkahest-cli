import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { checkForUpdate, repoSlug } from "../core/version.js";

/**
 * Update the installed alkahest to the latest version.
 *
 * Version source is GitHub Releases (no npm) — see core/version.ts. The update mechanism
 * adapts to the install:
 *  - git checkout (`git clone` + `npm link`): `git pull` + reinstall in place (`npm install`
 *    re-runs the `prepare` build), so the linked `alkahest` updates.
 *  - anything else (e.g. `npm i -g github:…`, which strips .git): print the reinstall command.
 *
 * `--check` only reports current-vs-latest and changes nothing.
 */
export interface UpdateOptions {
  check?: boolean;
}

export async function update(options: UpdateOptions = {}): Promise<void> {
  const require = createRequire(import.meta.url);
  const pkgRoot = dirname(require.resolve("../../package.json"));

  const { current, latest, behind } = await checkForUpdate();
  console.log(`[alkahest] current version ${current}`);
  if (latest && !behind) {
    console.log(`[alkahest] already up to date (latest release ${latest}).`);
    return;
  }
  if (latest) console.log(`[alkahest] update available: ${current} → ${latest}`);
  else console.log(`[alkahest] (no published GitHub release to compare against — will pull latest source.)`);

  if (options.check) return; // report-only

  if (!existsSync(join(pkgRoot, ".git"))) {
    console.log("[alkahest] this install isn't a git checkout — update by reinstalling:");
    console.log(`  npm install -g github:${repoSlug()}`);
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
}
