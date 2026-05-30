# Alkahest

[English](./README.md) · **한국어**

> 코드에서 제품을 역으로 복원해, 사람이 제품 결정을 내리게 한다.

UI 코드베이스를 **정적 분석**해 **제품 지도(Product Map)** 를 만드는 CLI입니다.
화면을 노드로, 화면 간 이동과 화면이 부르는 API/데이터 호출을 엣지로 뽑아내, 인터랙티브 대시보드로 보여주고 PRD·요구사항 작성을 돕습니다.

플랫폼은 **어댑터로 확장**합니다 — 현재 **Next.js (app-router)** 와 **SwiftUI** 지원. 데이터 모델이 플랫폼 무관이라 어댑터만 추가하면 다른 프레임워크도 됩니다.

레퍼런스들(graphify·codegraph·Understand-Anything)이 *코드 심볼* 그래프라면, Alkahest는 한 단계 위 **화면(screen) 레벨의 제품 이해**를 목표로 합니다 — 대상 사용자는 **PM/기획자**.

```
화면(Screen) ──이동(Link/router.push/redirect)──▶ 화면(Screen)
     │
     └──호출(fetch/useQuery/server action)──▶ 리소스(API 엔드포인트/데이터)
```

## 2-레이어 그래프

- **노드**: `Screen`(route/page) · `Resource`(화면이 부르는 API·데이터)
- **엣지**: `Transition`(화면→화면 이동) · `Call`(화면→리소스 호출)
- 여러 화면이 같은 리소스를 부르면 노드를 공유 → "어떤 화면들이 `/api/orders`를 함께 쓰는가"가 그래프로 드러납니다(데이터 의존성·변경 영향).

## 두 가지 실행 모드 — LLM 키가 필요한가?

핵심 산출물 `map.json`은 **결정론적이라 키가 전혀 필요 없습니다.** LLM은 요약·PRD 같은 *선택적 위층*에서만 쓰이고, 누가 그 LLM이냐가 모드를 가릅니다.

| | **에이전트 모드** (스킬/도구로 호출) | **스탠드얼론 모드** (사람이 직접) |
|---|---|---|
| 누가 추론 | 호출한 에이전트(Claude Code/Codex/Cursor)가 이미 LLM | Alkahest가 자체 호출 |
| `ANTHROPIC_API_KEY` | **불필요** | 필요 |
| 통로 | `alkahest mcp` (MCP 서버) | `scan --summarize` / `prd` |

## 설치

> npm 배포 예정. 현재는 소스에서 빌드해 사용합니다.

```bash
git clone https://github.com/cr8rcho/alkahest.git
cd alkahest
npm install
npm run build
npm link          # 'alkahest' 명령을 전역에 연결 (선택)
```

배포 후에는: `npm i -g alkahest` 또는 `npx alkahest …`

## 사용법

분석할 프로젝트 루트에서 실행하면, 그 프로젝트 안 `.alkahest/` 에 산출물이 생깁니다.

```bash
alkahest scan              # 분석 → .alkahest/map.json + index.html (기본: 증분)
alkahest scan --full       # 기준선 무시하고 전체 재스캔
alkahest view              # 대시보드를 로컬 서버로 열기 (2-레이어 그래프)
alkahest scan --summarize  # 화면별 LLM 요약 채우기 (ANTHROPIC_API_KEY 필요)
alkahest prd checkout      # 화면 PRD/요구사항 마크다운 생성 → .alkahest/prd/checkout.md
alkahest hook install      # 커밋·머지 시 scan 자동 실행 (diff 자동 갱신)
alkahest mcp               # MCP 서버 실행 (에이전트가 제품 지도를 질의, 키 불필요)
```

### 대시보드 조작

- **force-directed 레이아웃** — 노드가 연결 관계에 따라 자연스럽게 자리잡습니다. 시드 고정이라 매번 같은 배치.
- **시작점**은 라벨 앞 `▶` 로 표시 (앱 진입점 / 루트 라우트)
- **호버**: 노드에 올리면 연결된 엣지·이웃이 색으로 강조 (미리보기)
- **클릭**: 화면을 선택해 우측 패널에 기능·이동·호출을 고정 표시
- **드래그**로 노드 이동(연결된 이웃이 따라옴), **휠/핀치**로 확대·축소, 빈 곳 드래그로 이동
- 우상단 **🌗** 라이트/다크 전환, **⤢ 맞춤** 전체 보기
- 엣지: 실선 = 이동, 짧은 점선 = 포함, 긴 점선 = 호출

### 에이전트(MCP) 연동

에이전트의 MCP 설정에 추가하면, 에이전트가 `scan` / `overview` / `get_screen` / `who_calls` 도구로 제품 지도를 질의하고 **요약·PRD는 에이전트 자신이** 작성합니다(별도 키 불필요).

```json
{
  "mcpServers": {
    "alkahest": { "command": "alkahest", "args": ["mcp"] }
  }
}
```

## 산출물 — `.alkahest/`

```
.alkahest/
├─ map.json       # 표준 ProductMap (모든 출력의 원천)
├─ index.html     # 자기완결 인터랙티브 대시보드 (외부 의존성/네트워크 없음)
└─ prd/<screen>.md
```

`index.html`은 데이터 + 렌더 코드를 모두 인라인한 **자기완결 파일**이라, alkahest나 서버 없이 브라우저로 바로 열립니다. `.alkahest/` 는 `.gitignore` 에 추가하길 권장합니다.

## 증분 + 자동 갱신

`scan`은 기본 **증분**입니다 — `map.json`의 파일 해시와 비교해 바뀐 화면만 재파싱하고, 변경되지 않은 화면은 LLM 요약까지 그대로 보존합니다. `alkahest hook install`로 git hook을 걸면 커밋·머지 때마다 자동으로 갱신됩니다.

## 지원 범위 / 한계

현재 어댑터:

| 어댑터 | 화면 | 이동 | 호출 |
|---|---|---|---|
| **Next.js app-router** | `app/**/page.tsx` | `<Link>`·`router.push`·`redirect` | `fetch`·query 훅 |
| **SwiftUI** | `struct X: View` | `NavigationLink`·`.sheet`·`.fullScreenCover`·`navigationDestination` | `URL(string:)`·`URLRequest` |

- **한계**: 파일/뷰 단위로 파싱 — 임포트한 자식 컴포넌트 내부의 기능/호출은 아직 미추적. 동적 대상(`router.push(변수)`, `useQuery` 훅의 URL 등)은 "미해결"로 표시.
- pages router / React Router / Compose 등 추가 어댑터, 런타임 스크린샷은 수요에 따라 추가 예정 — 새 플랫폼은 `src/core/adapters/`에 어댑터 하나 추가하면 됩니다.

## 개발

```bash
npm install
npm run build
node dist/cli.js scan examples/sample-next   # 번들 픽스처로 시험
npm run typecheck
```

설계 단일 출처는 [`ALKAHEST.md`](./ALKAHEST.md) 입니다.

## License

MIT
