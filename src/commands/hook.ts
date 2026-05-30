import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Install/remove a git hook that auto-refreshes the product map on diffs (ALKAHEST.md §10).
 * Incremental logic lives in `scan`; this hook only triggers it — the two are separate.
 */
const HOOKS = ["post-commit", "post-merge"];
const START = "# >>> alkahest >>>";
const END = "# <<< alkahest <<<";
const BLOCK =
  `${START}\n` +
  `# Auto-refresh the product map on diffs (ALKAHEST.md §10). Remove: alkahest hook uninstall\n` +
  `alkahest scan >/dev/null 2>&1 || npx --no-install alkahest scan >/dev/null 2>&1 || true\n` +
  `${END}\n`;

export async function hook(action: string): Promise<void> {
  const root = resolve(".");
  const gitPath = join(root, ".git");
  if (!existsSync(gitPath)) {
    console.log("[alkahest] not a git repository (no .git).");
    return;
  }
  if (!statSync(gitPath).isDirectory()) {
    console.log("[alkahest] .git is a file (worktree/submodule) — install the hook manually.");
    return;
  }
  const hooksDir = join(gitPath, "hooks");
  mkdirSync(hooksDir, { recursive: true });

  if (action === "install") {
    for (const h of HOOKS) installOne(join(hooksDir, h));
    console.log(`[alkahest] git hooks installed: ${HOOKS.join(", ")} → runs 'alkahest scan' (incremental) on commit/merge`);
  } else if (action === "uninstall") {
    for (const h of HOOKS) uninstallOne(join(hooksDir, h));
    console.log(`[alkahest] git hooks removed: ${HOOKS.join(", ")}`);
  } else {
    console.log("usage: alkahest hook <install|uninstall>");
  }
}

function installOne(file: string): void {
  let content = existsSync(file) ? readFileSync(file, "utf8") : "#!/bin/sh\n";
  if (content.includes(START)) return; // already installed (idempotent)
  if (!content.startsWith("#!")) content = "#!/bin/sh\n" + content;
  if (!content.endsWith("\n")) content += "\n";
  writeFileSync(file, content + "\n" + BLOCK);
  chmodSync(file, 0o755);
}

function uninstallOne(file: string): void {
  if (!existsSync(file)) return;
  const content = readFileSync(file, "utf8");
  const re = new RegExp(`\\n?${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}\\n?`, "g");
  const next = content.replace(re, "\n");
  if (next !== content) writeFileSync(file, next);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
