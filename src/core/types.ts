/**
 * Alkahest 핵심 데이터 모델 — ALKAHEST.md §3 의 구현.
 *
 * `map.json` 이 ProductMap 의 표준 직렬화이며, 대시보드(view)와 PRD 생성(prd)은
 * 전부 이 구조를 읽어서 동작한다. 모델이 바뀌면 ALKAHEST.md 를 먼저 고친다.
 */

/** 소스 코드 위치 — 클릭하면 에디터에서 점프할 수 있게 한다. */
export interface SourceLoc {
  /** 프로젝트 루트 기준 상대 경로 */
  file: string;
  line: number;
}

/**
 * 화면 내부의 UI 요소 한 조각 — 사용자가 화면에서 *보거나 조작*하는 것.
 * 그 요소의 *효과*(다른 화면으로 이동 / 백엔드 호출)는 Feature 가 아니라
 * 엣지(Transition / Call)로 표현한다. (ALKAHEST.md §3)
 */
export interface Feature {
  kind: "form" | "button" | "input" | "list" | "conditional";
  /** 사람이 읽는 이름 — "로그인 폼", "결제하기 버튼" */
  label: string;
  /** 근거: 컴포넌트/handler 이름, 조건식 등 */
  detail: string;
  loc: SourceLoc;
}

/** 그래프 노드 = 하나의 화면(route/page). */
export interface Screen {
  /** route path 기반 안정적 식별자 */
  id: string;
  /** "/dashboard/settings" */
  route: string;
  /** "app/dashboard/settings/page.tsx" (프로젝트 루트 기준 상대) */
  sourceFile: string;
  /** 증분 갱신용 파일 내용 해시 — ALKAHEST.md §9 */
  sourceHash: string;
  /** 사람이 읽는 화면 이름 */
  title: string;
  /** LLM이 쓴 "이 화면에서 사용자가 뭘 하나" — Phase 3까지는 빈 문자열 */
  summary: string;
  features: Feature[];
  /** 이 화면에서 쓰인 주요 컴포넌트 이름 */
  components: string[];
}

/** 1차 레이어 엣지 = 화면 → 화면(또는 외부 URL) 이동(navigation). */
export interface Transition {
  from: string; // Screen.id
  /** 대상 Screen.id, 또는 외부 URL, 또는 정적으로 못 푼 경우 null */
  to: string | null;
  /**
   * 엣지 종류:
   *  - "navigate": 사용자가 일으키는 이동 (Link/router.push/.sheet/NavigationLink 등)
   *  - "contains": 화면이 자식 화면을 포함 (TabView/embed) — 구조적 흐름. 시작점 판별에 사용.
   */
  kind: "navigate" | "contains";
  /** 미해결 이동이면 원본 표현식 텍스트 (예: "router.push(path)") */
  rawTarget?: string;
  /** "<Link href>" | "router.push" | "form action" | "redirect()" | "<a href>" | "Tab"/"embed" */
  trigger: string;
  loc: SourceLoc;
}

/**
 * 2차 레이어 노드 = 화면이 *부르는* 백엔드/데이터 능력 (ALKAHEST.md §3).
 * 여러 화면이 같은 리소스를 부르면 같은 노드를 공유 → "어떤 화면들이 함께 쓰는가" 가 드러난다.
 */
export interface Resource {
  /** method+path 또는 식별 가능한 이름 기반 안정적 식별자 */
  id: string;
  kind: "endpoint" | "server-action" | "rpc" | "data-source" | "external";
  /** 사람이 읽는 이름 — "GET /api/orders" */
  label: string;
  /** HTTP method (endpoint 일 때) */
  method?: string;
  /** 경로 또는 URL — "/api/orders" */
  path?: string;
}

/** 2차 레이어 엣지 = 화면 → 리소스 호출(call). */
export interface Call {
  from: string; // Screen.id
  /** 대상 Resource.id, 또는 정적으로 못 푼 경우 null */
  to: string | null;
  /** 미해결 호출이면 원본 표현식 텍스트 */
  rawTarget?: string;
  /** "fetch" | "useQuery" | "useMutation" | "server action" | handler 이름 등 */
  trigger: string;
  loc: SourceLoc;
}

export type Framework = "next" | "react-router" | "vite-react" | "swiftui" | "unknown";
export type Router = "next-app" | "next-pages" | "react-router" | "swiftui-views" | "unknown";

export interface ProductMapMeta {
  framework: Framework;
  router: Router;
  /** ISO 8601 — scan 시점 */
  scannedAt: string;
  /** 절대 경로 */
  projectRoot: string;
  /** 증분 갱신 기준선: 화면 파일별 내용 해시 — ALKAHEST.md §9 */
  fileHashes: Record<string, string>;
  /** 이 map 을 만든 alkahest 버전 */
  alkahestVersion: string;
}

/** 전체 제품 지도 — `.alkahest/map.json` 의 루트. */
export interface ProductMap {
  /** 1차 레이어 노드: 화면 */
  screens: Screen[];
  /** 2차 레이어 노드: 화면이 부르는 리소스(API/데이터/server action) */
  resources: Resource[];
  /** 1차 레이어 엣지: 화면 → 화면 이동 */
  transitions: Transition[];
  /** 2차 레이어 엣지: 화면 → 리소스 호출 */
  calls: Call[];
  meta: ProductMapMeta;
}
