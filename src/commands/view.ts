import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emitDashboard, OUTPUT_DIR } from "../core/emit.js";
import { serveDashboard } from "../core/serve.js";
import type { ProductMap } from "../core/types.js";

/**
 * `.alkahest/` 대시보드를 로컬 서버로 띄워 화면-플로우/호출 그래프를 탐색 (ALKAHEST.md §5).
 * map.json 으로부터 index.html 을 매번 재생성해 최신 템플릿을 반영한다.
 */
export async function view(path: string): Promise<void> {
  const projectRoot = resolve(path);
  const mapPath = join(projectRoot, OUTPUT_DIR, "map.json");
  if (!existsSync(mapPath)) {
    console.log(`[alkahest] ${mapPath} 가 없습니다 — 먼저 'alkahest scan' 을 실행하세요.`);
    return;
  }
  const map = JSON.parse(readFileSync(mapPath, "utf8")) as ProductMap;
  emitDashboard(projectRoot, map);
  await serveDashboard(projectRoot);
}
