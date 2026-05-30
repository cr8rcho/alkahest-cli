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

/** 원시 신호(parse) → 2-레이어 ProductMap (전체 빌드, ALKAHEST.md §3). */
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
    screens.push(screenFromRaw(file.route, file.relPath, hashes.get(file.relPath) ?? "", raw));
    transitions.push(...resolveTransitions(file.route, raw.navs, routes, file.relPath));
    calls.push(...resolveCalls(file.route, raw.calls, file.relPath, resources));
  }

  return assembleMap({
    screens,
    transitions,
    calls,
    resources: [...resources.values()],
    hashes,
    discovery,
    projectRoot: input.projectRoot,
    scannedAt: input.scannedAt,
    alkahestVersion: input.alkahestVersion,
  });
}

/** 한 화면 파일의 원시 신호 → Screen 노드 (엣지 제외). */
export function screenFromRaw(route: string, relPath: string, hash: string, raw: RawScreen): Screen {
  return {
    id: route,
    route,
    sourceFile: relPath,
    sourceHash: hash,
    title: titleFromRoute(route),
    summary: "",
    features: raw.features.map((f) => ({ kind: f.kind, label: f.label, detail: f.detail, loc: { file: relPath, line: f.line } })),
    components: raw.components,
  };
}

/** 한 화면의 navs → Transition[] (route 집합 기준 해석). */
export function resolveTransitions(from: string, navs: RawNav[], routes: Set<string>, file: string): Transition[] {
  return navs.map((nav) => resolveTransition(from, nav, routes, file));
}

/** 한 화면의 calls → Call[]. 발견한 Resource 를 resourceMap 에 dedupe 적재. */
export function resolveCalls(from: string, raw: RawCall[], file: string, resourceMap: Map<string, Resource>): Call[] {
  return raw.map((call) => resolveCall(from, call, resourceMap, file));
}

/** 외부 URL 여부. */
export function isExternalUrl(s: string): boolean {
  return /^https?:\/\//.test(s);
}

export interface AssembleInput {
  screens: Screen[];
  transitions: Transition[];
  calls: Call[];
  resources: Resource[];
  hashes: Map<string, string>;
  discovery: Discovery;
  projectRoot: string;
  scannedAt: string;
  alkahestVersion: string;
}

/** 노드/엣지/리소스 → 최종 ProductMap (메타 채움, 리소스 정렬). */
export function assembleMap(a: AssembleInput): ProductMap {
  return {
    screens: a.screens,
    resources: a.resources.sort((x, y) => x.id.localeCompare(y.id)),
    transitions: a.transitions,
    calls: a.calls,
    meta: {
      framework: a.discovery.framework,
      router: a.discovery.router,
      scannedAt: a.scannedAt,
      projectRoot: a.projectRoot,
      fileHashes: Object.fromEntries(a.hashes),
      alkahestVersion: a.alkahestVersion,
    },
  };
}

// ---------- internals ----------

function resolveTransition(from: string, nav: RawNav, routes: Set<string>, file: string): Transition {
  const loc = { file, line: nav.line };
  if (nav.target == null) {
    return { from, to: null, rawTarget: nav.raw, trigger: nav.trigger, loc };
  }
  const clean = nav.target.split(/[?#]/)[0];
  if (isExternalUrl(clean)) {
    return { from, to: clean, trigger: nav.trigger, loc }; // 외부 URL
  }
  let route = clean.startsWith("/") ? clean : "/" + clean;
  if (route.length > 1) route = route.replace(/\/+$/, "");
  if (routes.has(route)) {
    return { from, to: route, trigger: nav.trigger, loc };
  }
  return { from, to: null, rawTarget: nav.target, trigger: nav.trigger, loc };
}

function resolveCall(from: string, call: RawCall, resources: Map<string, Resource>, file: string): Call {
  const loc = { file, line: call.line };
  if (call.url == null) {
    return { from, to: null, rawTarget: call.raw, trigger: call.trigger, loc };
  }
  const path = call.url.split("#")[0];
  const external = isExternalUrl(path);
  const method = (call.method ?? "GET").toUpperCase();
  const id = `${method} ${path}`;
  if (!resources.has(id)) {
    resources.set(id, { id, kind: external ? "external" : "endpoint", label: id, method, path });
  }
  return { from, to: id, trigger: call.trigger, loc };
}

/** 라우트 → 사람이 읽는 화면 이름. */
function titleFromRoute(route: string): string {
  if (route === "/") return "Home";
  const last = route.split("/").filter(Boolean).pop() ?? route;
  return last
    .replace(/^\[(\.\.\.)?(.+?)\]$/, "$2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
