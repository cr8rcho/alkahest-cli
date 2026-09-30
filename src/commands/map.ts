import { loadMap } from "../core/pipeline.js";
import { fetchPublishedMap } from "../core/mapFetch.js";
import { loadCredentials, resolveToken } from "../core/credentials.js";
import { findProjectRoot } from "../core/project.js";
import { matchScreen, overview, screenDetail, whoCalls } from "../core/mapQuery.js";
import type { ProductMap } from "../core/types.js";

/**
 * `alkahest map …` — ask the product map the same questions the MCP `overview` / `get_screen` /
 * `who_calls` tools answer, from the shell. Reads the local `.alkahest/map.json` by default;
 * `--slug <project>` reads the PUBLISHED map instead (what the remote connector sees). Output
 * is JSON so it pipes into jq; `--json` is implied.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

export interface MapQueryOptions { path?: string; slug?: string; map?: string; api?: string }

async function loadFor(options: MapQueryOptions): Promise<ProductMap | null> {
  if (options.slug) {
    const token = resolveToken(undefined, loadCredentials());
    if (!token) { die("✗ Reading a published map needs a token — run 'alkahest login' first."); return null; }
    const map = await fetchPublishedMap({ api: options.api, token, project: options.slug, mapSlug: options.map });
    if (!map) die(`✗ No readable published code map for '${options.slug}'${options.map ? `/${options.map}` : ""} — check the slug with 'alkahest projects' and the map with 'alkahest maps list'.`);
    return map;
  }
  const root = findProjectRoot(options.path || ".");
  const map = loadMap(root);
  if (!map) die("✗ No .alkahest/map.json here — run 'alkahest scan' first, or pass --slug <project> to read the published map.");
  return map;
}

const print = (obj: unknown): void => console.log(JSON.stringify(obj, null, 2));

export async function mapOverview(options: MapQueryOptions): Promise<void> {
  const map = await loadFor(options);
  if (map) print(overview(map));
}

export async function mapScreen(screen: string, options: MapQueryOptions): Promise<void> {
  const map = await loadFor(options);
  if (!map) return;
  const s = matchScreen(map, screen);
  if (!s) return die(`✗ Screen not found: ${screen} — 'alkahest map overview' lists ids, routes and titles.`);
  print(screenDetail(map, s));
}

export async function mapWhoCalls(resource: string, options: MapQueryOptions): Promise<void> {
  const map = await loadFor(options);
  if (!map) return;
  const hits = whoCalls(map, resource);
  if (!hits.length) return die(`✗ No resource matches '${resource}' — 'alkahest map overview' lists them.`);
  print(hits);
}
