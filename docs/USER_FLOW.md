# 사용자 입장 플로우 — 설치부터 로그인, publish, 게이팅까지

> 다양한 사용자 / 다양한 프로젝트가 `alkahest`를 깔고 publish 하는 전 과정을 **사용자 시점**에서 정리.
> 인증 모델: **GitHub 로그인 → publish 토큰 발급 → CLI/MCP는 토큰으로 인증** (gh/vercel/npm과 동일 방식).
> **보는 사람(viewer)은 영원히 무료, publish 하는 사람이 유료.** (Figma식)

상태 표기: ✅ 구현됨 / 🔜 미구현(설계)

---

## 1. 설치 ✅
```bash
npm install -g alkahest     # 또는 npx alkahest <command>
```

## 2. 스캔 (로컬, 영원히 무료) ✅
```bash
cd ~/work/my-next-app
alkahest scan               # 정적분석 → ./.alkahest/map.json + index.html
alkahest view              # 로컬에서 혼자 확인 (인터넷 안 탐)
```
- 로컬 도구는 로그인·결제 없이 무제한. 게이팅 안 함.

## 3. 로그인 (publish 하려면 최초 1회) ✅
publish는 "내 클라우드 자원을 쓴다"는 행위 → 계정 필요.

1. 웹에서 `https://<app>/account` 접속 → **GitHub 로그인**
2. **Create token** → `alk_xxxxx` 복사 (한 번만 표시됨)
3. CLI에 저장:
   ```bash
   alkahest login --token alk_xxxxx --api https://<ref>.supabase.co/functions/v1
   ```
   → `~/.alkahest/credentials.json` 에 토큰 저장 (repo엔 안 들어감)

**MCP에서 쓸 때**: 같은 토큰을 MCP 설정 env에 넣음
```jsonc
{ "mcpServers": { "alkahest": {
  "command": "npx", "args": ["alkahest", "mcp"],
  "env": { "ALKAHEST_TOKEN": "alk_xxxxx" }
}}}
```

## 4. publish ✅ (플랜 게이팅 ✅, 결제 🔜)
```bash
alkahest publish
```
내부 동작:
1. `.alkahest/map.json` 읽음 (없으면 → "run scan first")
2. 토큰 없으면 → "not logged in. Run 'alkahest login'"
3. 서버가 **토큰 → 유저** 해석. 유효하지 않으면 401.
4. **처음 publish하는 프로젝트면** → 서버가 프로젝트를 **그 유저 소유로 자동 생성**
   (이름 = 폴더명 또는 `--name`), slug 발급. slug는 로컬에 프로젝트 경로별로 기억됨.
5. **재publish면** → 기억된 slug로 같은 링크 갱신 (소유자 검증).
6. `map.json`만 업로드 (소스코드 안 올라감).
7. 출력:
   ```
   [alkahest] published my-next-app-a1b2c3
     → https://<app>/p/my-next-app-a1b2c3
   ```

### "유료 아니라서 막힘" — Free 한도 초과 시 ✅
서버 `publish`가 `FREE_PROJECT_LIMIT`(현재 1개) 초과를 막는다:
```
$ alkahest publish
[alkahest] ✗ Publish blocked — Free plan allows 1 project. Upgrade to Pro for unlimited.
  Upgrade to Pro, or 'alkahest view' still works locally for free.
$ echo $?   → 1
```
- 동작: 서버 `403 { error: "plan_limit" }` → CLI가 위 메시지로 변환.
- 다른 사람 프로젝트에 publish 시도 → `403 forbidden`.
- 토큰 폐기/무효 → `401 invalid_token` → "run login again".

## 5. 공유 ✅ (보는 사람은 무료)
- 링크를 PM·디자이너·비개발자 누구에게나 전달.
- 그들은 **설치·로그인·결제 전부 없이** 브라우저로 열어 봄.
- `scan && publish` 다시 하면 같은 링크가 최신으로 갱신.
- CI에서 자동: 토큰을 CI 시크릿에 넣고 `publish` → push마다 갱신.

## 6. 계정 관리 ✅
웹 `/account` 에서:
- 토큰 발급/목록/폐기 (last used 표시)
- 내 프로젝트 목록 + 뷰어 링크

## 7. 업그레이드 / 결제 🔜
- Free 한도 초과 시 Upgrade 링크 → Stripe 체크아웃 → 구독
- 결제 완료 → webhook이 `profiles.plan = 'pro'` 로 갱신 → 다음 publish부터 한도 해제 (재설치 불필요)

---

## 다양한 사용자 / 프로젝트일 때
- **한 유저, 여러 프로젝트**: 토큰 1개로 전부 커버. 프로젝트마다 독립 slug. Free면 1개 제한.
- **여러 유저**: 각자 GitHub 로그인 → 각자 토큰 → 각자 프로젝트 소유. 서버가 누가 올렸는지 앎.
- **토큰 분실**: 웹에서 새로 발급 (유저에 묶여 있어 복구 가능 — 익명 시절과 다른 점).

## 플랜 경계 (초안)
| | Free | Pro 🔜 | Team/Enterprise 🔜 |
|---|---|---|---|
| scan / view / 로컬 HTML | ✅ | ✅ | ✅ |
| publish (공유 링크) | ✅ | ✅ | ✅ |
| 프로젝트 수 | **1** | 무제한 | 무제한 |
| viewer 수 | 무제한 | 무제한 | 무제한 |
| 비공개 링크 | ❌(공개만) | ✅ | ✅ |
| 코멘트/멤버 권한 | ❌ | 일부 | ✅ |
| SSO/온프렘 | ❌ | ❌ | ✅ |

> 원칙: **로컬(혼자, 내 머신)은 영원히 무료. 클라우드(공유, 내 서버 자원)에서 규모 커지면 유료.**

## 요약
- 깔고 → scan/view(무료) → **login(GitHub 토큰)** → publish → 누구나 무료로 보는 링크.
- **publish가 유일한 게이트**: Free 한도 초과/비공개 원하면 업그레이드.
- 보는 사람은 항상 무료. 돈 내는 건 "많이/비공개로 publish 하는 사람"뿐.
