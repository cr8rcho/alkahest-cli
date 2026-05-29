import { readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Framework, Router } from "./types.js";

/** 발견된 화면 파일 하나 (ALKAHEST.md §4-1 Discover). */
export interface ScreenFile {
  /** 절대 경로 */
  absPath: string;
  /** projectRoot 기준 상대 경로 (posix 구분자) */
  relPath: string;
  /** 라우트 경로 — "/dashboard/settings" */
  route: string;
}

export interface Discovery {
  framework: Framework;
  router: Router;
  /** 절대 경로, 없으면 null */
  appDir: string | null;
  screenFiles: ScreenFile[];
}

const PAGE_RE = /^page\.(tsx|jsx|ts|js)$/;

/**
 * 프로젝트 타입/라우터 감지 + 화면 파일 열거.
 * Phase 1: Next app-router 만 지원 (`app/` 또는 `src/app/` 의 page.* ).
 */
export function discover(projectRoot: string): Discovery {
  const appDir = [join(projectRoot, "app"), join(projectRoot, "src", "app")].find(
    (d) => existsSync(d) && statSync(d).isDirectory(),
  );
  if (!appDir) {
    return { framework: "unknown", router: "unknown", appDir: null, screenFiles: [] };
  }

  const screenFiles: ScreenFile[] = [];
  walk(appDir, (file) => {
    const base = file.slice(file.lastIndexOf(sep) + 1);
    if (!PAGE_RE.test(base)) return;
    screenFiles.push({
      absPath: file,
      relPath: relative(projectRoot, file).split(sep).join("/"),
      route: routeFromAppFile(appDir, file),
    });
  });
  screenFiles.sort((a, b) => a.route.localeCompare(b.route));

  return { framework: "next", router: "next-app", appDir, screenFiles };
}

function walk(dir: string, onFile: (file: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

/**
 * app-router 파일 경로 → 라우트. 규칙:
 * - `app/page.tsx` → `/`
 * - 라우트 그룹 `(marketing)` 세그먼트는 경로에서 제거
 * - 동적 세그먼트 `[slug]` 는 그대로 유지
 */
function routeFromAppFile(appDir: string, file: string): string {
  const segs = relative(appDir, file)
    .split(sep)
    .slice(0, -1) // page.* 제거
    .filter((s) => !(s.startsWith("(") && s.endsWith(")"))); // 라우트 그룹 제거
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}
