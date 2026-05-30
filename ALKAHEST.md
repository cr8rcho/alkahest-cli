# Alkahest

> 코드에서 제품을 역으로 복원해, 사람이 제품 결정을 내리게 한다.
>
> 이 문서는 **설계 단일 출처(single source of truth)** 다. 방향이 바뀌면 코드보다 먼저 여기를 고친다.

---

## 1. 한 줄 정의

UI 코드베이스를 정적 분석해 **"제품 지도(Product Map)"** 를 만든다.
화면(screen)을 노드로, 화면 간 이동을 엣지로, 각 화면 안의 기능을 속성으로 뽑아
인터랙티브 HTML 대시보드로 보여주고, 거기서 **PRD·요구사항 문서를 추출**한다.

플랫폼은 **어댑터로 확장**한다(§8) — 현재 **Next.js(app-router)** 와 **SwiftUI** 지원. 모델은 플랫폼 무관이라 새 어댑터만 추가하면 된다.

대상 사용자: **PM/기획자** (개발자도 부차적). 대상 제품: **웹/모바일 UI 앱** (React·Next, SwiftUI, …).

## 2. 포지셔닝 — 왜 다른가

레퍼런스(graphify, codegraph, Understand-Anything)는 전부 **코드 심볼(파일/함수/클래스/콜체인)** 레벨의 지식 그래프다. 개발자가 *코드*를 이해하게 한다.

Alkahest는 한 단계 위, **화면(screen) 레벨의 제품 이해**를 목표로 한다.

| | 레퍼런스 3종 | Alkahest |
|---|---|---|
| 노드 | 파일/함수/클래스 | **화면(route/page) + 리소스(API/데이터)** |
| 엣지 | import / call chain | **이동(화면→화면) + 호출(화면→리소스)** |
| 화면 내부 | — | **UI 기능(폼·버튼·리스트·조건)** |
| 산출 | 코드 이해 그래프 | **제품 지도 + PRD 초안** |
| 사용자 | 개발자/학습자 | **PM/기획자** |

핵심 가치: "코드만 있고 스펙 문서가 없는 제품"의 스펙을 **역으로 복원**해서, 기획 의사결정(PRD 작성, 요구사항 정의, 변경 영향 파악)을 돕는다.

## 3. 핵심 개념 — 데이터 모델

**노드 2종 · 엣지 2종**의 2-레이어 그래프:
- 노드: `Screen`(화면) · `Resource`(화면이 부르는 API/데이터/server action)
- 엣지: `Transition`(화면→화면, **이동**) · `Call`(화면→리소스, **호출**)
- `Feature`는 화면 *UI 요소*(폼·버튼·리스트·조건)만 — 그 요소의 *효과*(이동/호출)는 엣지로 분리.

```
ProductMap {
  screens:     Screen[]      // 1차 노드: 화면
  resources:   Resource[]    // 2차 노드: 화면이 부르는 리소스
  transitions: Transition[]  // 1차 엣지: 화면 → 화면 이동
  calls:       Call[]        // 2차 엣지: 화면 → 리소스 호출
  meta:        { framework, router, scannedAt, projectRoot, fileHashes }
                              // fileHashes: { [path]: hash } — 증분 갱신 기준선 (§11)
}

Screen {
  id, route, sourceFile
  sourceHash: string         // 증분 갱신용 파일 해시 — §11
  title, summary             // summary: LLM이 쓴 "사용자가 뭘 하나" (Phase 3)
  features:   Feature[]      // 화면 UI 요소
  components: string[]
}

Feature {  // 화면에서 보거나 조작하는 UI 요소 (효과는 엣지로)
  kind:  "form" | "button" | "input" | "list" | "conditional"
  label, detail, loc
}

Resource {  // 화면이 부르는 백엔드/데이터 능력. 여러 화면이 공유 가능.
  id
  kind:  "endpoint" | "server-action" | "rpc" | "data-source" | "external"
  label, method?, path?      // "GET /api/orders"
}

Transition {  // 이동
  from: screenId, to: screenId | externalUrl | null
  rawTarget?                 // 정적으로 못 푼 경우 원본 표현식
  trigger, loc               // "<Link href>" | "router.push" | "redirect()" ...
}

Call {  // 호출
  from: screenId, to: resourceId | null
  rawTarget?                 // 미해결 호출 원본 표현식
  trigger, loc               // "fetch" | "useQuery" | "server action" ...
}
```

`map.json` 이 이 모델의 표준 직렬화이고, 대시보드와 PRD 생성은 전부 이걸 읽어서 동작한다.
**핵심**: 여러 화면이 같은 `Resource`를 부르면 같은 노드를 공유 → "어떤 화면들이 `/api/orders`를 함께 쓰는가"가 그래프로 드러난다 (데이터 의존성·변경 영향 파악).

## 4. 파이프라인

```
 scan
 ├─ 1. Discover   프로젝트 타입/라우터 감지 → 화면 파일 목록
 │                (Next app router: app/**/page.tsx, pages router: pages/**/*.tsx)
 ├─ 2. Parse      각 화면 AST 파싱 → JSX/이벤트핸들러/네비게이션/데이터호출 추출
 ├─ 3. Resolve    href→화면 id (Transition), fetch/action 대상→리소스 (Call·dedupe), UI는 Feature 귀속
 └─ 4. Emit       .alkahest/map.json + .alkahest/index.html (자기완결 대시보드)

 view   .alkahest/ 를 로컬 서버로 띄워 그래프 탐색
 (요약·PRD는 LLM이 필요 — Alkahest가 직접 안 하고, MCP로 연결된 에이전트가 작성, §7)
```

## 5. 산출물 — `.alkahest/`

프로젝트 안의 **독립 폴더**에 생성 (분석 대상 코드와 섞이지 않음, `.gitignore` 권장).

```
.alkahest/
├─ map.json            # 표준 ProductMap (모든 출력의 원천)
└─ index.html          # 인터랙티브 대시보드 (자기완결, 데이터+렌더코드 인라인)
```

**대시보드 UX** (force-directed, 미니멀 스타일 F, 라이트/다크):
- 그래프: 화면(원)·리소스(사각) 노드 + 이동(실선)·포함(짧은 점선)·호출(긴 점선) 엣지. 시작점은 라벨에 `▶`.
- 호버: 연결 엣지·이웃 색 강조(미리보기). 클릭: 우측 패널에 요약·기능·이동·호출 고정 + 액센트 링.
- 노드 클릭(리소스) → 그 리소스를 **함께 부르는 화면들** 표시 (데이터 의존성·변경 영향).
- 드래그(이웃 따라옴)·휠/핀치 줌·팬, 🌗 테마, ⤢ 맞춤.
- `index.html`은 데이터+렌더JS+CSS를 모두 인라인 → alkahest/서버 없이 브라우저로 바로 열림.

## 6. CLI 표면

```
alkahest scan [path]      # 분석 → .alkahest/map.json + index.html  (기본: cwd, 증분)
alkahest scan --full      # 기준선 무시하고 전체 재스캔
alkahest scan --open      # scan 후 바로 view
alkahest view             # .alkahest/ 대시보드를 로컬 서버로 오픈
alkahest mcp              # MCP 서버(stdio) — 에이전트가 제품 지도 질의 (키 불필요, §7)
alkahest hook install     # git post-commit/post-merge에 자동 scan 설치 (diff 자동 갱신, §10)
```

대상은 **단일 프로젝트(코드베이스) 하나**. `scan`은 기본 **증분**(§11).

## 7. 키 불필요 — 추론은 에이전트가

**Alkahest의 핵심 산출물은 결정론적 `map.json`이며, LLM/키가 전혀 필요 없다.** Alkahest는 LLM을 직접 호출하지 않는다. 요약·PRD·요구사항 같은 서술형 출력이 필요하면 **호출한 에이전트(Claude Code/Codex/Cursor)가** 추론한다 — 그 에이전트가 이미 LLM이므로.

- **핵심 원칙**: scan→`map.json`→view 는 전부 결정론적, 키 없음. 서술형 글쓰기는 에이전트의 몫.
- 에이전트 통합: **MCP 서버 — 구현 완료** (`alkahest mcp`, stdio). 도구 `scan`/`overview`/`get_screen`/`who_calls` 노출, 추론(요약·PRD)은 호출 에이전트가 수행. 도구 description에 사용법이 담겨 **Skill 없이도 동작** — Skill은 워크플로 방법론이 필요할 때 나중에 얹는 선택적 Claude 전용 보강.
  - 에이전트 MCP 설정: `{ "command": "alkahest", "args": ["mcp"] }` (대상 프로젝트 디렉터리에서 실행).
- **(폐기) 스탠드얼론 키 모드**: 초기엔 `scan --summarize`/`prd`가 Anthropic SDK로 자체 호출했으나, 에이전트(클코/Codex)를 쓰면 잉여라 제거함(2026-05). `@anthropic-ai/sdk`·`llm.ts`·`prd` 명령 삭제. 필요해지면 i18n 메시지 테이블처럼 선택 의존성으로 되살릴 수 있음.

## 8. 어댑터 레이어 (다중 플랫폼)

플랫폼별로 갈리는 건 **discover + parse 뿐**이고, resolve/emit/dashboard/MCP/증분은 전부 공유한다. 각 어댑터는 공통 `FrameworkAdapter` 인터페이스(`detect`/`discover`/`parse`)를 구현하며, 파싱 방식은 자유(어댑터마다 다름). 새 플랫폼 = 어댑터 하나 추가 + `ADAPTERS` 등록.

| 어댑터 | 화면 | 이동 | 호출 | 파서 |
|---|---|---|---|---|
| **next-app** | `app/**/page.tsx` (route) | `<Link>`/`router.push`/`redirect` | `fetch`/query훅 | ts-morph (AST) |
| **swiftui** | `struct X: View` | `NavigationLink`/`.sheet`/`.fullScreenCover`/`navigationDestination` | `URL(string:)`/`URLRequest` | 정규식 휴리스틱(의존성 0) |

- 어댑터는 `src/core/adapters/`. `selectAdapter()`가 `detect()`로 자동 선택.
- 파서는 언어 비종속 — Swift은 휴리스틱으로 시작, 정확도 필요 시 tree-sitter로 교체 가능(인터페이스 동일).
- 검증: iobook(순수 SwiftUI) → 화면 41·이동 62·호출 6, Gemini API/정책 URL 등 리소스 추출. Next 픽스처 무회귀.

## 9. 기술 스택

- **런타임/언어**: Node + TypeScript (ESM). 대상이 JS 생태계라 파싱 친화적.
- **CLI**: 가벼운 인자 파서 (commander 또는 자체).
- **파싱**: `ts-morph` (TS 컴파일러 래퍼, TSX·타입 해석에 가장 ergonomic) 1순위. 멀티언어 확장 시 tree-sitter 고려.
- **LLM**: Alkahest는 **직접 호출 안 함**. 요약·PRD는 MCP로 연결된 에이전트가 작성(§7). (구 `@anthropic-ai/sdk` 의존성은 제거됨.)
- **MCP**: `@modelcontextprotocol/sdk` + `zod`(v3) — 에이전트 모드 서버.
- **대시보드 그래프**: 자체 SVG force-directed (외부 CDN 없이 자기완결 HTML에 인라인, 시드 고정으로 결정론적).

> octokit 제약(ESM/tsx 깨짐)은 (구) 원격 경로 얘기였고, 신 방향은 **로컬 파일 직접 분석**이라 무관. → [[verify-lib-via-next-route]]

## 10. 단계별 로드맵

- **Phase 0 — Scaffold**: package.json / tsconfig / CLI 엔트리 / `.alkahest/` 규약.
- **Phase 1 — Screen Graph (정적, LLM 없음)**: Next app-router 화면 발견 + 이동 엣지 + `map.json`. CLI `scan`. 콘솔로 그래프 검증.
- **Phase 2 — Dashboard**: 자기완결 `index.html` (그래프 + 화면 상세 패널 + 기능 목록). `view`.
- **Phase 3 — 에이전트 통합(MCP)**: `alkahest mcp` 서버. 요약·PRD는 에이전트가 작성(키 불필요). ~~초기 스탠드얼론 키 모드(scan --summarize/prd)~~ 는 제거됨(§7).
- **Phase 4 — 확장**: pages router / React Router / Vite, 그리고 **런타임 스크린샷 보강(Playwright)** — 진짜 렌더 썸네일을 노드에 입힘 (선택).

## 11. 증분 업데이트 (diff-driven)

대상은 **단일 프로젝트**고, 코드에 diff가 생기면 제품 지도가 따라 갱신돼야 한다.
전체 재스캔은 비싸므로 `scan`은 **변경된 파일만 재처리**하는 증분 갱신을 1급으로 지원한다.

- **기준선**: `map.json`의 `meta.fileHashes`(또는 git tree)와 현재 파일을 비교 → 변경/추가/삭제된 화면 파일 집합 도출.
- **재처리 범위**: 바뀐 화면만 재파싱하고, 그 화면을 가리키던/가리키는 **엣지만** 재해석. (요약은 에이전트가 채우므로 alkahest 증분 대상 아님.)
- **트리거 = hook (전달 수단)**: 사람이 매번 치지 않게 hook이 `scan`을 부른다.
  - git `post-commit` / `post-merge` hook, 또는
  - Claude Code 하니스 hook(편집 후), 또는
  - `--watch` 모드(개발 중 파일 감시).
- 즉 **증분 로직은 `scan` 안에**, **자동 실행은 hook이** 담당. 둘을 분리한다.

**구현 완료**: `scan`은 기본 증분 — `map.json`의 `fileHashes`와 비교해 **해시가 같은 화면은 재파싱하지 않고 보존**, 변경/추가만 재처리, 삭제된 화면을 가리키던 내부 이동은 미해결로 강등. `--full`로 전체 재스캔. `alkahest hook install`이 git `post-commit`/`post-merge`에 멱등하게 자동 `scan`을 심는다(`uninstall`로 제거). 미구현: `--watch`, Claude Code 하니스 hook 연동.

## 12. 알려진 트레이드오프 / 열린 질문

- **"눈으로 보는" 한계**: 정적 분석은 실제 렌더 스크린샷을 못 준다. 1차 시각화는 *그래프 + 구조화된 기능 뷰*. 진짜 화면 썸네일은 Phase 4 런타임 보강의 몫. (정적-우선으로 빠르게 가치 확보 → 필요 시 런타임 보강)
- **이동 해석 정확도**: 동적 href(`router.push(variable)`)는 정적으로 못 풀 수 있음 → "미해결 이동"으로 표시.
- **프레임워크 범위**: Phase 1은 Next app router에만 집중. 욕심내지 않는다.

---

_마지막 갱신: 2026-05-30 · 상태: P1~P3(MCP) + 증분/hook + 어댑터(Next·SwiftUI) + force 레이아웃 + 미니멀 스타일(라이트/다크) + **소스 전체 영어화 + 키 모드 제거**. CLI: scan/view/mcp/hook. 다음: 배포(npm publish), MCP 실연동, 어댑터 추가·자식 컴포넌트 추적_

**그래프 모델:** 엣지에 `kind`("navigate" 사용자이동 / "contains" 구조적포함). 어댑터가 진입점(`ScreenFile.isEntry`)과 contains 후보(대문자 생성자 호출)를 내고, `resolveContains`가 screenIds 교집합만 엣지화. 대시보드는 **force-directed**(시드 고정·결정론적, 중력은 초기 정착만), 시작점은 라벨 `▶`, 직선 엣지(이동 실선/포함 짧은점선/호출 긴점선), 호버 미리보기·클릭 선택·세로 무튕김 드래그.

**Phase 1 알려진 한계(다음 보강 대상):**
- 페이지 파일 *자체만* 파싱 — 임포트한 컴포넌트 내부의 기능/호출은 미추적.
- `useQuery`/`useSWR` 등 훅의 URL(queryFn 내부)은 미해결 호출로 표기.
- 동적 `router.push(변수)`/템플릿 href는 미해결.
- 자식 컴포넌트 미추적이 가장 큰 데이터 품질 갭 — 실제 앱은 페이지가 컴포넌트를 조합하므로.
