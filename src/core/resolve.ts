import type { ProductMap, Screen, Resource, Transition, Call } from "./types.js";
import type { Discovery } from "./discover.js";
import type { RawScreen, RawNav, RawCall } from "./parse.js";

export interface ResolveInput {
  discovery: Discovery;
  /** key = ScreenFile.relPath */
  parsed: Map<string, RawScreen>;
  /** key = ScreenFile.relPath → 내용 해시 */
  hashes: Map<string, string>;
  projectRoot: string;
  scannedAt: string;
  alkahestVersion: string;
}

/** 원시 신호(parse) → 2-레이어 ProductMap(ALKAHEST.md §3). */
export function buildMap(input: ResolveInput): ProductMap {
  const { discovery, parsed, hashes } = input;
  const routes = new Set(discovery.screenFiles.map((f) => f.route));

  const screens: Screen[] = [];
  const transitions: Transition[] = [];
  const calls: Call[] = [];
  const resources = new Map<string, Resource>();

  for (const file of discovery.screenFiles) {
    const raw = parsed.get(file.relPath);
    if (!raw) continue;
    const screenId = file.route;

    screens.push({
      id: screenId,
      route: file.route,
      sourceFile: file.relPath,
      sourceHash: hashes.get(file.relPath) ?? "",
      title: titleFromRoute(file.route),
      summary: "",
      features: raw.features.map((f) => ({
        kind: f.kind,
        label: f.label,
        detail: f.detail,
        loc: { file: file.relPath, line: f.line },
      })),
      components: raw.components,
    });

    for (const nav of raw.navs) {
      transitions.push(resolveTransition(screenId, nav, routes, file.relPath));
    }
    for (const call of raw.calls) {
      calls.push(resolveCall(screenId, call, resources, file.relPath));
    }
  }

  return {
    screens,
    resources: [...resources.values()].sort((a, b) => a.id.localeCompare(b.id)),
    transitions,
    calls,
    meta: {
      framework: discovery.framework,
      router: discovery.router,
      scannedAt: input.scannedAt,
      projectRoot: input.projectRoot,
      fileHashes: Object.fromEntries(hashes),
      alkahestVersion: input.alkahestVersion,
    },
  };
}

function resolveTransition(from: string, nav: RawNav, routes: Set<string>, file: string): Transition {
  const loc = { file, line: nav.line };
  if (nav.target == null) {
    return { from, to: null, rawTarget: nav.raw, trigger: nav.trigger, loc };
  }
  const clean = nav.target.split(/[?#]/)[0];
  if (/^https?:\/\//.test(clean)) {
    return { from, to: clean, trigger: nav.trigger, loc }; // 외부 URL
  }
  let route = clean.startsWith("/") ? clean : "/" + clean;
  if (route.length > 1) route = route.replace(/\/+$/, "");
  if (routes.has(route)) {
    return { from, to: route, trigger: nav.trigger, loc };
  }
  // 내부 경로 같지만 매칭되는 화면 없음(동적 세그먼트 등) → 미해결
  return { from, to: null, rawTarget: nav.target, trigger: nav.trigger, loc };
}

function resolveCall(from: string, call: RawCall, resources: Map<string, Resource>, file: string): Call {
  const loc = { file, line: call.line };
  if (call.url == null) {
    return { from, to: null, rawTarget: call.raw, trigger: call.trigger, loc };
  }
  const path = call.url.split("#")[0];
  const external = /^https?:\/\//.test(path);
  const method = (call.method ?? "GET").toUpperCase();
  const id = `${method} ${path}`;
  if (!resources.has(id)) {
    resources.set(id, {
      id,
      kind: external ? "external" : "endpoint",
      label: id,
      method,
      path,
    });
  }
  return { from, to: id, trigger: call.trigger, loc };
}

/** 라우트 → 사람이 읽는 화면 이름. */
function titleFromRoute(route: string): string {
  if (route === "/") return "Home";
  const last = route.split("/").filter(Boolean).pop() ?? route;
  return last
    .replace(/^\[(\.\.\.)?(.+?)\]$/, "$2") // [slug] / [...slug] → slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
