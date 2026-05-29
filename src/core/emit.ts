import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductMap } from "./types.js";

/** 산출물 폴더 이름 (ALKAHEST.md §5). */
export const OUTPUT_DIR = ".alkahest";

/** ProductMap 을 `<projectRoot>/.alkahest/map.json` 으로 직렬화. 경로를 반환. */
export function emitMap(projectRoot: string, map: ProductMap): string {
  const dir = join(projectRoot, OUTPUT_DIR);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "map.json");
  writeFileSync(file, JSON.stringify(map, null, 2) + "\n");
  return file;
}
