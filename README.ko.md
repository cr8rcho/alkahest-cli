# Alkahest

[English](./README.md) · **한국어**

> 코드에서 제품을 역으로 복원해, 사람이 제품 결정을 내리게 한다.

UI 코드베이스를 **정적 분석**해 **제품 지도(Product Map)** 를 만드는 CLI입니다.
화면을 노드로, 화면 간 이동과 화면이 부르는 API/데이터 호출을 엣지로 뽑아내, 인터랙티브 대시보드로 보여주고 PRD·요구사항 작성을 돕습니다.

플랫폼은 **어댑터로 확장**합니다 — **현재 21개**: React(Next.js·React Router·Remix), Vue(Nuxt·Vue Router), Angular, Svelte, Astro, React Native, SwiftUI/UIKit, Jetpack Compose, Flutter, 서버사이드 Django/Flask/Rails(+ 순수 HTML). 데이터 모델이 플랫폼 무관이라 새 프레임워크는 어댑터 하나만 추가하면 됩니다.

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

## 키 불필요 — 추론은 에이전트가

핵심 산출물 `map.json`은 **결정론적이라 LLM 키가 필요 없습니다.** Alkahest는 LLM을 직접 호출하지 않습니다. 요약·PRD·요구사항 같은 서술형 출력이 필요하면, **에이전트**가 추론합니다 — Alkahest를 MCP 서버로 연결하면 Claude Code / Codex / Cursor가 제품 지도를 질의해서 직접 글을 씁니다. 키도, SDK도 없습니다.

```
나 ── "체크아웃 화면 PRD 써줘" ──▶ 에이전트 (Claude Code / Codex)
                                     │  get_screen / who_calls (MCP)
                                     ▼
                                  Alkahest  →  map.json (결정론적, 키 없음)
```

## 설치

```bash
npm i -g @cr8rcho/alkahest      # 실행 명령은 `alkahest`
# 설치 없이 실행:  npx @cr8rcho/alkahest <명령>
```

소스에서 (컨트리뷰터):

```bash
git clone https://github.com/cr8rcho/alkahest-cli.git
cd alkahest-cli && npm install && npm run build && npm link
```

## 빠른 시작 (Claude Code)

Claude Code 사용자가 0부터 대시보드에서 그래프 + PRD를 보기까지:

```bash
# 1. alkahest 설치:  npm i -g @cr8rcho/alkahest   (또는 위처럼 소스 빌드 후 `npm link`)

# 2. 내 프로젝트 루트에서 제품 지도 생성
cd ~/my-next-app
alkahest scan                 # → .alkahest/map.json + index.html

# 3. Claude Code에 MCP 서버 등록 (project 스코프 = .mcp.json으로 공유)
claude mcp add alkahest -s project -- alkahest mcp
#   연결 확인:  `claude` 실행 후 `/mcp`  → 목록에 "alkahest" 표시
```

이제 **Claude Code에 말만 하면** 됩니다 — 알아서 alkahest MCP 도구를 씁니다:

```
나:  "이 제품 화면들 개요 좀 정리해줘."
        → Claude가 overview 호출 → 구조 요약.

나:  "체크아웃 화면이랑 장바구니 화면 PRD 써줘."
        → Claude가 get_screen / who_calls 로 구조를 읽고,
          각 PRD를 작성해 set_prd 로 map.json에 저장.

나:  "alkahest view"   (또는 터미널에서 직접 실행)
        → 대시보드가 열림. 화면 노드를 클릭하면 우측 패널에
          방금 Claude가 쓴 Summary + PRD가 보임.
```

요약: **scan → MCP 등록 → Claude에게 요청 → `view`.** 키 없음 — 글은 Claude가 쓰고, alkahest가 `map.json`에 저장해 자기완결 대시보드로 렌더합니다.

## 사용법

분석할 프로젝트 루트에서 실행하면, 그 프로젝트 안 `.alkahest/` 에 산출물이 생깁니다.

```bash
alkahest scan          # 분석 → .alkahest/map.json + index.html (기본: 증분)
alkahest scan --full   # 기준선 무시하고 전체 재스캔
alkahest view          # 대시보드를 로컬 서버로 열기 (2-레이어 그래프)
alkahest hook install  # 커밋·머지 시 scan 자동 실행 (diff 자동 갱신)
alkahest mcp           # MCP 서버 실행 (에이전트가 제품 지도를 질의, 키 불필요)
alkahest login         # publish 토큰 저장 (alkahest.app → Account → Create token)
alkahest publish       # 지도를 hosted 뷰어에 업로드 → 공유 링크
alkahest projects      # 계정의 워크스페이스·프로젝트 목록 (이동 후 slug 복구 등)
alkahest history       # 코드맵 발행 타임라인 — 언제 발행됐고 뭐가 바뀌었나
alkahest comments pull # 발행된 지도에 달린 댓글 가져오기 → .alkahest/comments.json
alkahest comments issue <ids…>  # 선택한 댓글들을 GitHub 이슈 하나로 파일링(gh) + 역링크
alkahest issues pull   # 프로젝트의 Issue Map(그래프형 이슈 트래커) 가져오기 → .alkahest/issues.json
alkahest issues add <제목>      # 이슈 생성 (--parent 에픽, --target s:…/r:…//route, --type/--status)
alkahest issues done <id>       # 이슈 완료 처리 (그 외: status / link / rm)
alkahest issues map <id>        # 이슈를 이슈 맵에 올리기 (--map), --remove 로 내리기 (이슈 자체는 삭제되지 않음)
alkahest notes add <제목>       # 프로젝트의 마인드맵 Note Map에 노트 생성 (--body, --parent, --map); 뷰어 캔버스에서 배치/연결
alkahest notes map <slug>       # 풀의 노트를 노트 맵에 올리기 (--map), --remove 로 내리기 (노트 자체는 삭제되지 않음)
alkahest notes delete <slug>    # 노트를 휴지통으로 (소프트 삭제; --reason "<이유>" 필수, 30일간 복원 가능) — restore <slug> 로 복원
alkahest update        # 최신 GitHub 릴리스로 업데이트 (--check: 확인만)
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

MCP 서버를 한 번 등록하면, 에이전트가 제품 지도를 읽고 **요약·PRD·요구사항을 직접** 작성합니다 — 키 불필요.

```bash
# Claude Code (권장): project 스코프는 공유용 .mcp.json 에 기록
claude mcp add alkahest -s project -- alkahest mcp
```

또는 MCP를 지원하는 다른 에이전트 설정에 직접 추가:

```json
{
  "mcpServers": {
    "alkahest": { "command": "alkahest", "args": ["mcp"] }
  }
}
```

**제공 도구:**

| 도구 | 하는 일 |
|---|---|
| `scan` | 프로젝트 제품 지도를 (재)생성 |
| `overview` | 전체 화면·리소스 목록 한눈에 |
| `get_screen` | 한 화면의 전체 구조(기능·이동·호출·소스) |
| `who_calls` | 특정 API/리소스를 부르는 화면들 (변경 영향) |
| `set_summary` | 화면에 한 줄 요약 저장 → 대시보드 패널에 표시 |
| `set_prd` | 화면에 PRD/요구사항 마크다운 저장 → 패널에 렌더 |
| `publish` | 지도를 hosted 뷰어에 올려 공유 링크 생성 (토큰 필요, 아래 참고) |
| `comments` | 발행된 지도에 달린 댓글 목록 — 각 댓글에 코드 위치를 조인: 화면 댓글 → 소스 파일/라우트 + 화면 요소(라인 번호), 리소스 댓글 → 그 엔드포인트를 부르는 화면들(파일+라인). 피드백을 에디터 안에서 처리 가능 (토큰 필요) |
| `resolve_comment` | 처리한 댓글을 resolve(또는 reopen) (토큰 필요) |
| `add_comment` / `reply_comment` | 지도 노드에 새 댓글 작성 / 기존 댓글에 답글 (토큰 필요) |
| `comment_to_issue` | 댓글 여러 개를 GitHub 이슈 하나로 묶어 파일링(로컬 `gh` 사용)하고 역링크 — hosted 뷰어에 "tracked" 배지 표시 (토큰 필요) |
| `issues` | 프로젝트의 **Issue Map** 읽기 — 의존성이 1급인 그래프형 이슈 트래커. 각 이슈에 파생 상태 `done`·`actionable`(막는 미완료 이슈 없음)이 붙어 다음 할 일을 고를 수 있음 (토큰 필요) |
| `add_issue` | 사용자와 기획하며 이슈 생성 — `parent_id`로 에픽 아래 묶고, `target`으로 코드 맵에 연결(기존 노드 키, 또는 아직 없는 `/route` — 화면이 실제로 생기면 자동 수렴) (토큰 필요) |
| `update_issue` | 상태 이동(작업 완료 시 done — 진행 상황이 맵에 칠해짐)·필드 수정·삭제 (토큰 필요) |
| `link_issues` | 이슈 간 엣지 추가/제거: `blocks`(의존성)·`contains`(에픽→태스크)·`relates` (토큰 필요) |
| `map_issue` | 이슈를 이슈 맵에 올리거나 `remove` 로 내리기 — 이슈 맵은 프로젝트 이슈 풀을 보는 렌즈라 한 이슈가 여러 맵에 동시에 올라갈 수 있고, 맵에서 내려도 이슈 자체는 삭제되지 않음 (토큰 필요) |
| `list_tasks` | 프로젝트의 **task** 읽기 — 이슈의 가벼운 형제(맵·상태·스레드 없는 평평한 체크리스트 항목). 기본 `open`, `status: all` 이면 완료 포함 (토큰 필요) |
| `add_task` | 작은 할 일을 발견하면 가볍게 task 로 적기 — 사용자의 홈 Tasks 밴드 + 활동 피드에 (에이전트로 표시돼) 뜨고, 커지면 이슈로 승격 가능; `dedup_key` 로 재스캔 멱등성. 스레드·결정이나 코드 링크가 필요한 문제면 `add_issue` 사용 (토큰 필요) |
| `notes` | 프로젝트의 **Note Map** 읽기 — 마인드맵으로 그려지는 마크다운 노트(프로젝트 단위 slug 주소 + 손으로 그린 엣지). 추가 전에 먼저 확인: 같은 주제 노트가 있으면 새로 만들지 말고 갱신 (토큰 필요) |
| `get_note` | 노트 하나 전체 보기: 마크다운 본문·연결·백링크, 이슈/코드 링크 포함 (토큰 필요) |
| `add_note` | 지속 가치가 있는 지식을 마크다운 노트로 기록 — 결정, 컨벤션, 제약; `parent_id` 는 마인드맵 child 엣지 (토큰 필요) |
| `update_note` | 주제의 지식이 진화하면 노트를 제자리에서 수정 — 재추가 말고 갱신; `delete: true` + 한 줄 `reason` 으로 휴지통에 소프트 삭제(30일 복원 가능), `restore: true` 로 복원 (토큰 필요) |
| `link_notes` | 노트를 다른 노트·이슈(`issue:<uuid>`)·코드맵 노드(`code:s:…`/`code:r:…`)에 연결 — 모든 링크는 명시적이며 본문은 절대 파싱하지 않음 (토큰 필요) |
| `map_note` | 풀의 노트를 노트 맵에 올리거나 `remove` 로 내리기 — 노트 맵은 프로젝트 노트 풀을 보는 렌즈라 한 노트가 여러 맵에 동시에 올라갈 수 있고, 맵에서 내려도 노트 자체는 삭제되지 않음 (토큰 필요) |
| `check_version` | 설치 버전 vs 최신 GitHub 릴리스 보고 (에이전트가 `alkahest update` 안내 가능) |

에이전트는 `get_screen` / `who_calls` 로 읽고 `set_summary` / `set_prd` 로 써넣습니다. 둘 다 `map.json`에 기록하고 `index.html`을 재생성하므로 대시보드가 항상 최신입니다.

**에이전트에서 publish (선택).** `scan`·읽기·쓰기는 키가 필요 없지만, `publish`는 지도를 계정에 업로드하므로 토큰이 필요합니다. **alkahest.app → Account → Create token** 에서 토큰을 받아 MCP 설정에 넣어주세요:

```bash
claude mcp add alkahest -s project \
  -e ALKAHEST_TOKEN=alk_xxxxx \
  -- alkahest mcp
```

```json
{
  "mcpServers": {
    "alkahest": {
      "command": "alkahest",
      "args": ["mcp"],
      "env": {
        "ALKAHEST_TOKEN": "alk_xxxxx"
      }
    }
  }
}
```

토큰만 있으면 됩니다 — CLI가 호스팅 서비스(alkahest.app)를 기본값으로 씁니다. 이미 `alkahest login` 을 했다면 토큰 env조차 생략 가능합니다(저장된 자격증명 사용). 그다음 에이전트에게 *"이거 publish 해줘"* 라고만 하면 링크를 돌려줍니다.

> 백엔드를 직접 셀프호스팅한다면 `-e ALKAHEST_API_URL=https://<ref>.supabase.co/functions/v1` (또는 `alkahest login --api <url>`)로 CLI를 그쪽으로 가리키세요.

## 산출물 — `.alkahest/`

```
.alkahest/
├─ map.json       # 표준 ProductMap (모든 출력의 원천)
└─ index.html     # 자기완결 인터랙티브 대시보드 (외부 의존성/네트워크 없음)
```

`index.html`은 데이터 + 렌더 코드를 모두 인라인한 **자기완결 파일**이라, alkahest나 서버 없이 브라우저로 바로 열립니다. `.alkahest/` 는 `.gitignore` 에 추가하길 권장합니다.

## 증분 + 자동 갱신

`scan`은 기본 **증분**입니다 — `map.json`의 파일 해시와 비교해 바뀐 화면만 재파싱하고, 나머지는 그대로 보존합니다. `alkahest hook install`로 git hook을 걸면 커밋·머지 때마다 자동으로 갱신됩니다.

## 지원 범위 / 한계

어댑터(21개, `src/core/adapters/`), 프레임워크별:

- **React** — Next.js(app·pages router), React Router(Vite/CRA), Remix, 순수 JSX
- **Vue** — Nuxt, Vue Router, Vue SFC · **Angular** · **Svelte**(SvelteKit) · **Astro**
- **React Native** — Expo Router, React Navigation
- **iOS** — SwiftUI, UIKit · **Android** — Jetpack Compose · **Flutter**
- 서버사이드 — **Django**, **Flask**, **Rails** · 순수 멀티페이지 **HTML**

소스 → 그래프 매핑 예시 두 가지:

| 어댑터 | 화면 | 이동 | 호출 |
|---|---|---|---|
| **Next.js app-router** | `app/**/page.tsx` | `<Link>`·`router.push`·`redirect` | `fetch`·query 훅 |
| **SwiftUI** | `struct X: View` | `NavigationLink`·`.sheet`·`.fullScreenCover`·`navigationDestination` | `URL(string:)`·`URLRequest` |

- **한계**: 파일/뷰 단위로 파싱 — 임포트한 자식 컴포넌트 내부의 기능/호출은 아직 미추적. 동적 대상(`router.push(변수)`, `useQuery` 훅의 URL 등)은 "미해결"로 표시.
- 데이터 모델이 플랫폼 무관 — 새 플랫폼은 `src/core/adapters/`에 어댑터 하나 추가하면 됩니다.

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
