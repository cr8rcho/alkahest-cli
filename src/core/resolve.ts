import type { ProductMap, Screen, Resource, Transition, Call, Framework, Router } from "./types.js";
import type { ScreenFile, RawScreen, RawNav, RawCall } from "./adapters/types.js";

export interface ResolveInput {
  files: ScreenFile[];
  /** key = ScreenFile.relPath */
  parsed: Map<string, RawScreen>;
  /** key = ScreenFile.relPath → 내용 해시 */
  hashes: Map<string, string>;
  framework: Framework;
  router: Router;
  projectRoot: string;
  scannedAt: string;
  alkahestVersion: string;
}

/** 원시 신호(parse) → 2-레이어 ProductMap (전체 빌드, ALKAHEST.md §3). 어댑터 무관. */
export function buildMap(input: ResolveInput): ProductMap {
  const { files, parsed, hashes } = input;
  const screenIds = new Set(files.map((f) => f.id));

  const screens: Screen[] = [];
  const transitions: Transition[] = [];
  const calls: Call[] = [];
  const resources = new Map<string, Resource>();

  for (const file of files) {
    const raw = parsed.get(file.relPath);
    if (!raw) continue;
    screens.push(screenFromRaw(file, hashes.get(file.relPath) ?? "", raw));
    const navTrans = resolveTransitions(file.id, raw.navs, screenIds, file.relPath);
    transitions.push(...navTrans);
    // 포함(contains): 이 화면이 직접 인스턴스화한 다른 화면 → 구조적 흐름(진입점→탭 등). §11
    transitions.push(...resolveContains(file.id, raw.contains, screenIds, navTrans, file.relPath));
    calls.push(...resolveCalls(file.id, raw.calls, file.relPath, resources));
  }

  return assembleMap({
    screens,
    transitions,
    calls,
    resources: [...resources.values()],
    hashes,
    framework: input.framework,
    router: input.router,
    projectRoot: input.projectRoot,
    scannedAt: input.scannedAt,
    alkahestVersion: input.alkahestVersion,
  });
}

/** 한 화면 파일의 원시 신호 → Screen 노드 (엣지 제외). title/id 는 어댑터가 정한 값을 사용. */
export function screenFromRaw(file: ScreenFile, hash: string, raw: RawScreen): Screen {
  return {
    id: file.id,
    route: file.route,
    sourceFile: file.relPath,
    sourceHash: hash,
    title: file.title,
    summary: "",
    features: raw.features.map((f) => ({ kind: f.kind, label: f.label, detail: f.detail, loc: { file: file.relPath, line: f.line } })),
    components: raw.components,
    isEntry: file.isEntry,
  };
}

/** 한 화면의 navs → Transition[] (화면 id 집합 기준 해석). */
export function resolveTransitions(from: string, navs: RawNav[], screenIds: Set<string>, file: string): Transition[] {
  return navs.map((nav) => resolveTransition(from, nav, screenIds, file));
}

/**
 * 화면이 인스턴스화한 자식 화면 → "contains" 엣지 (구조적 흐름, 시작점 판별용).
 * contains 후보 중 실제 화면(screenIds)인 것만, 자기 자신·이미 nav 로 연결된 것은 제외.
 */
export function resolveContains(
  from: string,
  candidates: string[],
  screenIds: Set<string>,
  existingNav: Transition[],
  file: string,
): Transition[] {
  const navTargets = new Set(existingNav.map((t) => t.to).filter(Boolean) as string[]);
  const out: Transition[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (c === from || !screenIds.has(c) || navTargets.has(c) || seen.has(c)) continue;
    seen.add(c);
    out.push({ from, to: c, kind: "contains", trigger: "embed", loc: { file, line: 0 } });
  }
  return out;
}

/** 한 화면의 calls → Call[]. 발견한 Resource 를 resourceMap 에 dedupe 적재. */
export function resolveCalls(from: string, raw: RawCall[], file: string, resourceMap: Map<string, Resource>): Call[] {
  return raw.map((call) => resolveCall(from, call, resourceMap, file));
}

export function isExternalUrl(s: string): boolean {
  return /^https?:\/\//.test(s);
}

export interface AssembleInput {
  screens: Screen[];
  transitions: Transition[];
  calls: Call[];
  resources: Resource[];
  hashes: Map<string, string>;
  framework: Framework;
  router: Router;
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
      framework: a.framework,
      router: a.router,
      scannedAt: a.scannedAt,
      projectRoot: a.projectRoot,
      fileHashes: Object.fromEntries(a.hashes),
      alkahestVersion: a.alkahestVersion,
    },
  };
}

// ---------- internals ----------

function resolveTransition(from: string, nav: RawNav, screenIds: Set<string>, file: string): Transition {
  const loc = { file, line: nav.line };
  const base = { from, kind: "navigate" as const, trigger: nav.trigger, loc };
  if (nav.target == null) {
    return { ...base, to: null, rawTarget: nav.raw };
  }
  if (isExternalUrl(nav.target)) {
    return { ...base, to: nav.target.split(/[?#]/)[0] };
  }
  const candidates = [nav.target, normalizeRoute(nav.target)];
  const hit = candidates.find((c) => screenIds.has(c));
  if (hit) return { ...base, to: hit };
  return { ...base, to: null, rawTarget: nav.target };
}

function normalizeRoute(target: string): string {
  const clean = target.split(/[?#]/)[0];
  let route = clean.startsWith("/") ? clean : "/" + clean;
  if (route.length > 1) route = route.replace(/\/+$/, "");
  return route;
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
