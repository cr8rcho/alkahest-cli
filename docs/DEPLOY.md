# Alkahest 호스팅 — 운영자(너)가 할 일

> 코드는 다 됐다. 이 문서는 **클라우드에 실제로 띄우기 위해 네 계정에서 직접 해야 하는 일**만 모았다.
> (Claude가 코드로 대신 못 하는, 계정·OAuth·배포 버튼류.)

## 현재 상태

**Supabase 백엔드** (project ref: `ytcmzkrvtomtcrcyqqcb`) — 배포·검증 완료
- 테이블: `projects`, `map_versions`, `profiles`, `api_tokens` + 공개 Storage 버킷 `maps`
- Edge Functions:
  - `create-token` (verify_jwt=true) — 로그인 유저가 publish 토큰 발급
  - `publish` (verify_jwt=false) — alk_ 토큰 인증 + 플랜 게이팅 + 프로젝트 자동 소유
  - `register` (deprecated) — 410 반환

**CLI** — `alkahest login` / `alkahest publish` (토큰 인증) 구현 완료

**웹** (`viewer/`, `npm run build:viewer` 로 생성)
- `index.html` — `/p/{slug}` 제품맵 뷰어
- `account.html` — `/account` GitHub 로그인 + 토큰 발급/관리 + 내 프로젝트
- `vercel.json` — 라우팅

---

## ✅ 체크리스트

### 1. GitHub OAuth 설정 (로그인 켜기) — **필수, 코드로 못 함**
사용자가 웹에서 GitHub 로그인하려면 OAuth 앱이 필요하다.

1. GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**
   - Application name: `Alkahest`
   - Homepage URL: `https://<your-vercel-app>` (아직 없으면 나중에 수정)
   - **Authorization callback URL**: `https://ytcmzkrvtomtcrcyqqcb.supabase.co/auth/v1/callback`
   - 만들고 **Client ID** + **Client Secret** 확보
2. Supabase 대시보드 → **Authentication → Providers → GitHub**
   - Enable 켜고 Client ID / Secret 입력 → Save
3. Supabase → **Authentication → URL Configuration**
   - Site URL / Redirect URLs 에 `https://<your-vercel-app>` (+ `/account`) 추가

### 2. 테스트 고아 파일 삭제
스모크 테스트로 올라간 Storage 파일 정리:
- Supabase → **Storage → `maps`** → `smoke-test-39ba8b/`, `viewer-demo-945c37/` 폴더 삭제

### 3. Vercel에 웹 배포
```bash
npm run build:viewer        # → viewer/ 생성 (index.html, account.html, vercel.json)
```
- Vercel → New Project → 이 저장소 연결
- **Root Directory: `viewer`**, Framework: Other(정적), 빌드명령 없음
- Deploy → 주소 확보 (`https://<your-app>.vercel.app`)

> `viewer/`를 `.gitignore` 해둔 상태라면 Vercel이 git에서 못 본다. 대안:
> - Root Directory를 저장소 루트로 두고, Build Command `npm run build:viewer`, Output Directory `viewer`
> - 또는 viewer를 별도 repo로 분리

### 4. 배포 후 설정값 맞추기
Vercel 주소가 정해지면:

- **Supabase 함수 secret**: `VIEWER_BASE_URL = https://<your-app>` 설정
  → publish 응답에 클릭 가능한 뷰어 링크가 나온다
- **웹 재빌드**(절대 링크용, 선택): `ALKAHEST_VIEWER_BASE=https://<your-app> npm run build:viewer` 후 재배포
- **GitHub OAuth / Supabase URL Config**의 도메인을 실제 Vercel 주소로 갱신

### 5. End-to-end 확인
```bash
# 1) 웹에서: https://<your-app>/account → GitHub 로그인 → Create token → alk_… 복사
# 2) CLI:
alkahest login --token alk_xxxxx --api https://ytcmzkrvtomtcrcyqqcb.supabase.co/functions/v1
cd ~/some-next-app
alkahest scan
alkahest publish          # → https://<your-app>/p/<slug> 링크 출력
# 3) 링크 열어서 확인. /account 에 프로젝트가 뜨는지도 확인.
```

### 6. 커스텀 도메인 (선택)
도메인(예: `alkahest.app`) 구입 → Vercel 연결 → GitHub OAuth/Supabase URL도 그 도메인으로.

---

## 🔜 유료 결제 (나중)

지금은 **모두 Free 플랜**(프로젝트 1개 제한이 `publish` 함수 `FREE_PROJECT_LIMIT`에 박혀 있음).
실제 과금하려면:

1. **Stripe** 연동 — 구독 체크아웃 + webhook
2. webhook이 `profiles.plan` 을 `pro` 로 갱신 → publish 함수가 자동으로 한도 해제
3. `account.html` 에 Upgrade 버튼 + 현재 플랜 표시

→ 플랜 경계/사용자 플로우는 `docs/USER_FLOW.md` 참고.

---

## 참고: 비용
- Supabase / Vercel 둘 다 무료 티어로 시작.
- 로컬 도구(scan/view)만 쓰면 네 비용 0. publish(호스팅) 쓰는 사람만 자원 소모.
