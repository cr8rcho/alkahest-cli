import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Update the installed alkahest to the latest version.
 *
 * Version source is GitHub Releases (no npm): we read the repo's latest release tag and
 * compare it to the installed version. The update mechanism then adapts to the install:
 *  - git checkout (the documented `git clone` + `npm link` setup): `git pull` + reinstall in
 *    place (`npm install` re-runs the `prepare` build), so the linked `alkahest` updates.
 *  - anything else (e.g. `npm i -g github:…`, which strips .git): print the reinstall command.
 *
 * `--check` only reports (current vs latest) and changes nothing.
 */
export interface UpdateOptions {
  /** Report current-vs-latest and exit without changing anything. */
  check?: boolean;
}

const FALLBACK_REPO = "cr8rcho/alkahest";

export async function update(options: UpdateOptions = {}): Promise<void> {
  const require = createRequire(import.meta.url);
  const pkgRoot = dirname(require.resolve("../../package.json"));
  const pkg = require("../../package.json") as { version: string; repository?: { url?: string } };
  const current = pkg.version;
  const repo = repoSlug(pkg.repository?.url) ?? FALLBACK_REPO;
  console.log(`[alkahest] current version ${current}`);

  const latest = await latestRelease(repo);
  if (latest) {
    if (cmpVersion(current, latest) >= 0) {
      console.log(`[alkahest] already up to date (latest release ${latest}).`);
      return;
    }
    console.log(`[alkahest] update available: ${current} → ${latest}`);
  } else {
    console.log(`[alkahest] (no published GitHub release to compare against — will pull latest source.)`);
  }

  if (options.check) return; // report-only

  if (!existsSync(join(pkgRoot, ".git"))) {
    console.log("[alkahest] this install isn't a git checkout — update by reinstalling:");
    console.log(`  npm install -g github:${repo}`);
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
      ? `[alkahest] pulled — already on ${updated}.`
      : `[alkahest] updated ${current} → ${updated}.`,
  );
}

/** Latest release tag (without a leading "v"), or null if none / unreachable. */
async function latestRelease(repo: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "alkahest-cli" },
    });
    if (!res.ok) return null; // 404 = no releases yet
    const body = (await res.json()) as { tag_name?: string };
    return body.tag_name ? body.tag_name.replace(/^v/i, "").trim() : null;
  } catch {
    return null; // offline / rate-limited — fail soft
  }
}

/** "owner/repo" from a repository.url like "git+https://github.com/owner/repo.git". */
function repoSlug(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?(?:$|[/#?])/i);
  return m ? m[1] : null;
}

/** Compare dotted versions: -1 if a<b, 0 if equal, 1 if a>b (major.minor.patch). */
function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
