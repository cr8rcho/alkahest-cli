import type { Feature, Framework, Router } from "../types.js";

/**
 * 프레임워크 어댑터 레이어 (ALKAHEST.md §8 어댑터).
 * discover+parse 만 프레임워크별로 갈리고, resolve/emit/dashboard/MCP 는 공유한다.
 * 새 플랫폼 지원 = 어댑터 하나 추가. 파싱 방식(AST/정규식/tree-sitter)은 어댑터 자유.
 */

/** 발견된 화면 파일 하나. id/route/title 은 어댑터가 채운다. */
export interface ScreenFile {
  /** 절대 경로 */
  absPath: string;
  /** projectRoot 기준 상대 경로 (posix) */
  relPath: string;
  /** 안정적 화면 식별자. Next=route("/x"), SwiftUI=View 이름 */
  id: string;
  /** 라우트 표기 (없으면 id 와 동일) */
  route: string;
  /** 사람이 읽는 이름 */
  title: string;
  /** 앱 진입점 여부 (@main/App 이 띄우는 루트, 또는 "/" 라우트). */
  isEntry?: boolean;
}

// ---- parse 단계 원시 신호 (resolve 가 그래프 모델로 변환) ----

export interface RawNav {
  /** 정적으로 푼 대상 화면 식별자/URL, 못 풀면 null */
  target: string | null;
  raw: string;
  trigger: string;
  line: number;
}
export interface RawCall {
  /** 정적으로 푼 엔드포인트 URL, 못 풀면 null */
  url: string | null;
  method?: string;
  raw: string;
  trigger: string;
  line: number;
}
export interface RawFeature {
  kind: Feature["kind"];
  label: string;
  detail: string;
  line: number;
}
export interface RawScreen {
  navs: RawNav[];
  calls: RawCall[];
  features: RawFeature[];
  components: string[];
  /**
   * 이 화면이 직접 인스턴스화한 다른 화면 후보 (대문자 생성자 호출).
   * resolve 가 screenIds 와 교집합만 "contains"(구조적 포함) 엣지로 만든다.
   * 예: SwiftUI TabView 의 Recents()/Assets(), 부모가 박는 자식 View.
   */
  contains: string[];
}

/** 프레임워크 어댑터. */
export interface FrameworkAdapter {
  id: Framework;
  router: Router;
  /** 이 프로젝트가 이 어댑터 대상인가? (가볍게 판별) */
  detect(projectRoot: string): boolean;
  /** 화면 파일 열거 (id/route/title 채움). */
  discover(projectRoot: string): ScreenFile[];
  /** 화면 파일 하나를 파싱해 원시 신호 추출. */
  parse(file: ScreenFile): RawScreen;
}
