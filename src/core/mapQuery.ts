import type { ProductMap, Screen } from "./types.js";

/**
 * Read-only questions over a product map, shared by the MCP tools (`overview` / `get_screen` /
 * `who_calls`) and the CLI `alkahest map …` group so both answer identically. Pure functions —
 * the caller decides where the map comes from (local .alkahest/map.json or the published bytes).
 */

export function overview(map: ProductMap) {
  return {
    framework: map.meta.framework,
    router: map.meta.router,
    screens: map.screens.map((s) => ({
      id: s.id,
      route: s.route,
      title: s.title,
      features: s.features.length,
      navigatesTo: map.transitions.filter((t) => t.from === s.id).length,
      calls: map.calls.filter((c) => c.from === s.id).length,
    })),
    resources: map.resources.map((r) => ({
      id: r.id,
      label: r.label,
      calledByScreens: new Set(map.calls.filter((c) => c.to === r.id).map((c) => c.from)).size,
    })),
  };
}

/** Find a screen by id, route or title (case-insensitive, slashes trimmed). */
export function matchScreen(map: ProductMap, arg: string): Screen | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/^\/+|\/+$/g, "");
  const t = norm(arg);
  return map.screens.find((s) => norm(s.id) === t || norm(s.route) === t || norm(s.title) === t);
}

export function screenDetail(map: ProductMap, s: Screen) {
  const resourceLabel = (id: string) => map.resources.find((r) => r.id === id)?.label ?? id;
  return {
    id: s.id,
    route: s.route,
    title: s.title,
    sourceFile: s.sourceFile,
    summary: s.summary || null,
    prd: s.prd || null,
    features: s.features,
    components: s.components,
    navigatesTo: map.transitions
      .filter((t) => t.from === s.id)
      .map((t) => ({ to: t.to ?? t.rawTarget ?? "(unresolved)", via: t.trigger, loc: t.loc })),
    navigatedFrom: map.transitions
      .filter((t) => t.to === s.id)
      .map((t) => ({ from: t.from, via: t.trigger, loc: t.loc })),
    calls: map.calls
      .filter((c) => c.from === s.id)
      .map((c) => ({ resource: c.to ? resourceLabel(c.to) : c.rawTarget ?? "(unresolved)", via: c.trigger, loc: c.loc })),
  };
}

/** Resources matching `query` (id exact, or path/label substring) with the screens that call each. */
export function whoCalls(map: ProductMap, query: string) {
  const q = query.toLowerCase();
  return map.resources
    .filter((r) => r.id.toLowerCase() === q || (r.path ?? "").toLowerCase().includes(q) || r.label.toLowerCase().includes(q))
    .map((r) => ({
      resource: r.label,
      callers: map.calls.filter((c) => c.to === r.id).map((c) => ({ screen: c.from, via: c.trigger, loc: c.loc })),
    }));
}
