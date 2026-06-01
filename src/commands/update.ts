import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Update the installed alkahest to the latest version.
 *
 * Install methods differ, so we adapt to where this copy actually lives:
 *  - git checkout (the documented `git clone` + `npm link` setup): pull + reinstall in place
 *    (`npm install` re-runs the `prepare` build), so the linked `alkahest` command updates.
 *  - anything else (e.g. `npm i -g github:…`, which strips .git): we can't pull, so print the
 *    one-line reinstall command instead of guessing.
 */
export async function update(): Promise<void> {
  const require = createRequire(import.meta.url);
  const pkgRoot = dirname(require.resolve("../../package.json"));
  const current = (require("../../package.json") as { version: string }).version;
  console.log(`[alkahest] current version ${current}  (${pkgRoot})`);

  if (!existsSync(join(pkgRoot, ".git"))) {
    console.log("[alkahest] this install isn't a git checkout — update by reinstalling:");
    console.log("  npm install -g github:cr8rcho/alkahest");
    console.log("  (once published to npm: npm install -g alkahest@latest)");
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

  const updated = (JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { version: string }).version;
  console.log(
    updated === current
      ? `[alkahest] already up to date (${updated}).`
      : `[alkahest] updated ${current} → ${updated}.`,
  );
}
