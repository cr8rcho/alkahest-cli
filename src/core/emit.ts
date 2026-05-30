import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductMap } from "./types.js";
import { renderDashboard } from "./dashboard.js";

/** 산출물 폴더 이름 (ALKAHEST.md §5). */
export const OUTPUT_DIR = ".alkahest";

function ensureDir(projectRoot: string): string {
  const dir = join(projectRoot, OUTPUT_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** ProductMap 을 `<projectRoot>/.alkahest/map.json` 으로 직렬화. 경로를 반환. */
export function emitMap(projectRoot: string, map: ProductMap): string {
  const file = join(ensureDir(projectRoot), "map.json");
  writeFileSync(file, JSON.stringify(map, null, 2) + "\n");
  return file;
}

/** 자기완결 대시보드를 `<projectRoot>/.alkahest/index.html` 로 생성. 경로를 반환. */
export function emitDashboard(projectRoot: string, map: ProductMap): string {
  const file = join(ensureDir(projectRoot), "index.html");
  writeFileSync(file, renderDashboard(map));
  return file;
}
