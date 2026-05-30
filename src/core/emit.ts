import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductMap } from "./types.js";
import { renderDashboard } from "./dashboard.js";

/** Output folder name (ALKAHEST.md §5). */
export const OUTPUT_DIR = ".alkahest";

function ensureDir(projectRoot: string): string {
  const dir = join(projectRoot, OUTPUT_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Serializes the ProductMap to `<projectRoot>/.alkahest/map.json`. Returns the path. */
export function emitMap(projectRoot: string, map: ProductMap): string {
  const file = join(ensureDir(projectRoot), "map.json");
  writeFileSync(file, JSON.stringify(map, null, 2) + "\n");
  return file;
}

/** Generates the self-contained dashboard at `<projectRoot>/.alkahest/index.html`. Returns the path. */
export function emitDashboard(projectRoot: string, map: ProductMap): string {
  const file = join(ensureDir(projectRoot), "index.html");
  writeFileSync(file, renderDashboard(map));
  return file;
}
