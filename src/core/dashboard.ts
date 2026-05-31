import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ProductMap } from "./types.js";

/** Self-contained dashboard template (asset). Copied to dist/assets at build time (scripts/copy-assets.mjs). */
const TEMPLATE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "dashboard.html"), "utf8");

const PLACEHOLDER = "/*__ALKAHEST_MAP__*/";

/** Self-contained HTML string with the ProductMap inlined. No external dependencies/network. */
export function renderDashboard(map: ProductMap): string {
  const json = JSON.stringify(map).replace(/</g, "\\u003c"); // prevent </script> injection
  return TEMPLATE.replace(PLACEHOLDER, () => json);
}

/**
 * Dashboard shell with no data inlined — for the hosted viewer (Vercel).
 * At runtime it fetches the map from a sibling `map.json` or `?src=<url>`,
 * so the same HTML serves any project. See dashboard.html's loadMap().
 */
export function renderShell(): string {
  return TEMPLATE.replace(PLACEHOLDER, "");
}
