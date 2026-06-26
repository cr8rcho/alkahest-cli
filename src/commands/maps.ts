import { listMaps, createMap, type MapType } from "../core/maps.js";

/**
 * CLI surface of a project's maps (cloud ADR-011). `maps list` enumerates the project's maps and
 * `maps create` adds one — the discovery + creation primitives the `ambiguous_map` guidance from
 * `publish` / `issues add` points at. Talks to the `maps` edge function through src/core/maps.ts;
 * nothing is stored locally.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

const MAP_TYPES: MapType[] = ["code", "issue", "note"];

const failMessage = (code: string | undefined, message: string | undefined, action: string): string => {
  const known: Record<string, string> = {
    invalid_token: "✗ Token invalid or revoked. Run 'alkahest login' again.",
    forbidden: "✗ Only a project member or collaborator can do this.",
    not_found: `✗ ${message ?? "Not found."}`,
    no_slug: message ?? "No published map for this project yet — run 'alkahest publish', or pass --slug <slug>.",
    slug_taken: `✗ ${message ?? "A map with that slug already exists."}`,
  };
  return known[code ?? ""] ?? `${action} failed: ${message}`;
};

export interface MapsListOptions { api?: string; slug?: string; type?: string; }

export async function mapsList(path: string, options: MapsListOptions): Promise<void> {
  if (options.type && !MAP_TYPES.includes(options.type as MapType)) {
    return die(`✗ --type must be one of: ${MAP_TYPES.join(", ")}.`);
  }
  const res = await listMaps(path, { api: options.api, slug: options.slug, type: options.type as MapType | undefined });
  if (!res.ok || !res.maps) return die(failMessage(res.code, res.message, "maps list"));
  if (res.maps.length === 0) {
    console.log(`[alkahest] no maps on ${res.slug} yet — create one with 'alkahest maps create <slug> --type issue'.`);
    return;
  }
  console.log(`[alkahest] ${res.maps.length} map${res.maps.length === 1 ? "" : "s"} on ${res.slug}:`);
  for (const m of res.maps) {
    const archived = m.archived_at ? "  (archived)" : "";
    const name = m.name && m.name !== m.slug ? `  — ${m.name}` : "";
    console.log(`  [${m.type}] ${m.slug}${name}${archived}`);
  }
}

export interface MapsCreateOptions { api?: string; slug?: string; path?: string; type?: string; name?: string; }

export async function mapsCreate(mapSlug: string, options: MapsCreateOptions): Promise<void> {
  const type = options.type ?? "issue";
  if (!MAP_TYPES.includes(type as MapType)) {
    return die(`✗ --type must be one of: ${MAP_TYPES.join(", ")}.`);
  }
  const res = await createMap(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug, type: type as MapType, mapName: options.name,
  });
  if (!res.ok || !res.map) return die(failMessage(res.code, res.message, "maps create"));
  const m = res.map;
  console.log(`[alkahest] created ${m.type} map '${m.slug}'${m.name ? ` (${m.name})` : ""} on ${res.slug}`);
  if (m.type === "code") {
    console.log(`  publish to it with 'alkahest publish --map ${m.slug}'.`);
  } else if (m.type === "note") {
    console.log(`  add notes with 'alkahest notes add "<title>" --map ${m.slug}'.`);
  } else {
    console.log(`  add issues with 'alkahest issues add "<title>" --map ${m.slug}'.`);
  }
}
