import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emitDashboard, OUTPUT_DIR } from "../core/emit.js";
import { serveDashboard } from "../core/serve.js";
import type { ProductMap } from "../core/types.js";

/**
 * Serve the `.alkahest/` dashboard over a local server to explore the
 * screen-flow / call graph (ALKAHEST.md §5). Regenerates index.html from
 * map.json each time so the latest template is applied.
 */
export async function view(path: string): Promise<void> {
  const projectRoot = resolve(path);
  const mapPath = join(projectRoot, OUTPUT_DIR, "map.json");
  if (!existsSync(mapPath)) {
    console.log(`[alkahest] ${mapPath} not found — run 'alkahest scan' first.`);
    return;
  }
  const map = JSON.parse(readFileSync(mapPath, "utf8")) as ProductMap;
  emitDashboard(projectRoot, map);
  await serveDashboard(projectRoot);
}
