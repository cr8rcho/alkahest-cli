import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * diff 시 제품 지도를 자동 갱신하는 git hook 설치/제거 (ALKAHEST.md §10).
 * 증분 로직은 `scan` 안에, 자동 실행은 이 hook이 담당 — 둘을 분리한다.
 */
const HOOKS = ["post-commit", "post-merge"];
const START = "# >>> alkahest >>>";
const END = "# <<< alkahest <<<";
const BLOCK =
  `${START}\n` +
  `# diff 시 제품 지도 자동 갱신 (ALKAHEST.md §10). 제거: alkahest hook uninstall\n` +
  `alkahest scan >/dev/null 2>&1 || npx --no-install alkahest scan >/dev/null 2>&1 || true\n` +
  `${END}\n`;

export async function hook(action: string): Promise<void> {
  const root = resolve(".");
  const gitPath = join(root, ".git");
  if (!existsSync(gitPath)) {
    console.log("[alkahest] git 저장소가 아닙니다 (.git 없음).");
    return;
  }
  if (!statSync(gitPath).isDirectory()) {
    console.log("[alkahest] .git 이 파일입니다(worktree/submodule) — hook 수동 설치가 필요합니다.");
    return;
  }
  const hooksDir = join(gitPath, "hooks");
  mkdirSync(hooksDir, { recursive: true });

  if (action === "install") {
    for (const h of HOOKS) installOne(join(hooksDir, h));
    console.log(`[alkahest] git hook 설치: ${HOOKS.join(", ")} → 커밋/머지 시 'alkahest scan'(증분) 자동 실행`);
  } else if (action === "uninstall") {
    for (const h of HOOKS) uninstallOne(join(hooksDir, h));
    console.log(`[alkahest] git hook 제거: ${HOOKS.join(", ")}`);
  } else {
    console.log("사용법: alkahest hook <install|uninstall>");
  }
}

function installOne(file: string): void {
  let content = existsSync(file) ? readFileSync(file, "utf8") : "#!/bin/sh\n";
  if (content.includes(START)) return; // 이미 설치됨 (멱등)
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
