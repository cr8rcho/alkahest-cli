import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductMap } from "./types.js";

/** Output folder name (ALKAHEST.md §5). */
export const OUTPUT_DIR = ".alkahest";

function ensureDir(projectRoot: string): string {
  const dir = join(projectRoot, OUTPUT_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Serializes the ProductMap to `<projectRoot>/.alkahest/map.json`. Returns the path.
 * This is the only local artifact — the map is VIEWED on the hosted viewer via `publish`
 * (the local dashboard/`view` path was removed; maps live on alkahest.app).
 */
export function emitMap(projectRoot: string, map: ProductMap): string {
  const file = join(ensureDir(projectRoot), "map.json");
  writeFileSync(file, JSON.stringify(map, null, 2) + "\n");
  return file;
}
